import { getModelPrices, getServerConfig, LIMITS, RATE_LIMITS } from "@/lib/config";
import { UserFacingError } from "@/lib/core/errors";
import { runRequestSchema } from "@/lib/core/schemas";
import type { RunEvent, RunInput } from "@/lib/core/types";
import { createLlmClient } from "@/lib/llm";
import { runPipeline } from "@/lib/orchestrator";
import { ConcurrencyGate, MemoryRateLimiter } from "@/lib/ratelimit";
import { clientKey, isSameOrigin, readBodyLimited } from "@/lib/security";
import { FetchGitHubClient } from "@/lib/tools/github";

// Vercel Hobby with Fluid compute allows 300 seconds. The pipeline stops itself earlier.
export const maxDuration = 300;

const HEARTBEAT_MS = 10_000;

// Module scope: shared by every request this server instance handles.
const perIp = new MemoryRateLimiter(RATE_LIMITS.perIpRuns, RATE_LIMITS.perIpWindowMs);
const global = new MemoryRateLimiter(RATE_LIMITS.globalRuns, RATE_LIMITS.globalWindowMs);
const gate = new ConcurrencyGate(RATE_LIMITS.maxConcurrentRuns);

function refuse(status: number, message: string, retryAfterSec?: number): Response {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (retryAfterSec) headers["Retry-After"] = String(retryAfterSec);
  return Response.json({ error: message }, { status, headers });
}

/**
 * Starts one analysis and streams its progress as newline-delimited JSON.
 * Each line is one RunEvent. Every check that can refuse the request runs
 * before any model call is made.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return refuse(403, "This endpoint only accepts requests from the app itself.");
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return refuse(415, "Send the request as application/json.");
  }

  const raw = await readBodyLimited(request);
  if (raw === null) return refuse(413, "The request is too large.");

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return refuse(400, "The request body is not valid JSON.");
  }
  const parsed = runRequestSchema.safeParse(body);
  if (!parsed.success) return refuse(400, "The request is missing a story or a GitHub issue link.");

  const input: RunInput =
    parsed.data.kind === "github"
      ? { kind: "github", url: parsed.data.url }
      : { kind: "text", text: parsed.data.text, title: parsed.data.title };
  if (input.kind === "text" && input.text.length > LIMITS.maxInputChars) {
    return refuse(413, `Stories are limited to ${LIMITS.maxInputChars.toLocaleString("en-US")} characters.`);
  }

  const config = getServerConfig();
  if (config.demoMode === "replay") {
    return refuse(503, "Live runs are paused to protect the demo budget. The recorded sample runs still work.");
  }

  let llm;
  try {
    llm = createLlmClient(config);
  } catch (error) {
    return refuse(503, error instanceof UserFacingError ? error.message : "The app is not configured.");
  }

  const ipDecision = perIp.take(clientKey(request.headers));
  if (!ipDecision.allowed) {
    return refuse(429, "You have started several runs in a short time. Please wait a few minutes.", ipDecision.retryAfterSec);
  }
  const globalDecision = global.take("all");
  if (!globalDecision.allowed) {
    return refuse(429, "The app has reached its hourly run limit. Please try again later.", globalDecision.retryAfterSec);
  }
  const release = gate.enter();
  if (!release) return refuse(429, "All agents are busy with other runs. Please try again in a minute.", 30);

  const controller = new AbortController();
  const hardStop = setTimeout(() => controller.abort(), LIMITS.runHardStopMs);
  request.signal.addEventListener("abort", () => controller.abort(), { once: true });

  const encoder = new TextEncoder();
  const prices = getModelPrices();
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const cleanUp = () => {
    clearTimeout(hardStop);
    if (heartbeat) clearInterval(heartbeat);
    release();
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(streamController) {
      let open = true;
      const startedAt = Date.now();
      const send = (event: RunEvent) => {
        if (!open) return;
        try {
          streamController.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      // Keeps proxies from closing a connection that is quiet during a long model call.
      heartbeat = setInterval(() => send({ type: "ping", t: Date.now() - startedAt }), HEARTBEAT_MS);

      try {
        await runPipeline(
          input,
          {
            llm,
            github: new FetchGitHubClient(config.githubToken),
            models: { main: config.mainModel, fast: config.fastModel },
            prices,
            limits: LIMITS,
            runId: crypto.randomUUID(),
          },
          send,
          controller.signal,
        );
      } finally {
        cleanUp();
        if (open) {
          open = false;
          try {
            streamController.close();
          } catch {
            // The client already went away.
          }
        }
      }
    },
    cancel() {
      // The visitor closed the page or pressed Stop: stop paying for model calls.
      controller.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
