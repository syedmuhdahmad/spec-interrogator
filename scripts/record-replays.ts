/**
 * Records one live run of each sample into public/replays/<id>.json.
 * The app plays these back when DEMO_MODE=replay, so the demo keeps working
 * if the model budget runs out during judging.
 *
 * Usage: npm run record            (all samples)
 *        npm run record wallet-topup
 *
 * It spends real tokens: one full run per sample. A recording holds only the
 * events the browser already receives, so it contains no settings or keys.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getModelPrices, getServerConfig, LIMITS } from "../lib/config";
import type { RunEvent } from "../lib/core/types";
import { createLlmClient } from "../lib/llm";
import { runPipeline } from "../lib/orchestrator";
import { SAMPLES } from "../lib/samples";
import { FetchGitHubClient } from "../lib/tools/github";

async function main() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    console.error("No .env.local found. Copy .env.example to .env.local and fill it in.");
    process.exit(1);
  }

  const config = getServerConfig();
  if (config.mockLlm) {
    console.error("MOCK_LLM is set. Recordings must come from the real model: unset it and try again.");
    process.exit(1);
  }

  const wanted = process.argv.slice(2);
  const samples = SAMPLES.filter((sample) => wanted.length === 0 || wanted.includes(sample.id));
  if (samples.length === 0) {
    console.error(`No sample matches. Known ids: ${SAMPLES.map((sample) => sample.id).join(", ")}`);
    process.exit(1);
  }

  const outDir = path.join(process.cwd(), "public", "replays");
  mkdirSync(outDir, { recursive: true });

  for (const sample of samples) {
    const events: RunEvent[] = [];
    process.stdout.write(`Recording ${sample.id} ... `);
    await runPipeline(
      sample.input,
      {
        llm: createLlmClient(config),
        github: new FetchGitHubClient(config.githubToken),
        models: { main: config.mainModel, fast: config.fastModel },
        prices: getModelPrices(),
        limits: LIMITS,
        runId: `recorded-${sample.id}`,
      },
      (event) => {
        if (event.type !== "ping") events.push(event);
      },
      new AbortController().signal,
    );

    const last = events.at(-1);
    if (last?.type !== "run_done") {
      console.log(`FAILED (${last?.type === "run_error" ? last.message : "no result"}). Not saved.`);
      continue;
    }
    writeFileSync(path.join(outDir, `${sample.id}.json`), JSON.stringify(events));
    console.log(`ok: ${last.llmCalls} calls, ${last.tokensIn + last.tokensOut} tokens, about $${last.estCostUsd.toFixed(3)}${last.partial ? " (partial: review before using)" : ""}`);
  }
}

void main();
