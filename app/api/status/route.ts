import { connection } from "next/server";
import { getServerConfig, LIMITS } from "@/lib/config";

export interface AppStatus {
  /** "live": real model calls. "mock": local stand-in model. "replay": recorded runs only. "offline": not configured. */
  mode: "live" | "mock" | "replay" | "offline";
  maxInputChars: number;
}

/**
 * Tells the page which mode the server is in. It exposes no setting values,
 * only which mode applies.
 */
export async function GET(): Promise<Response> {
  // Read the environment at request time rather than freezing it into the build.
  await connection();
  const config = getServerConfig();
  const mode: AppStatus["mode"] =
    config.demoMode === "replay" ? "replay" : config.mockLlm ? "mock" : config.configured ? "live" : "offline";

  const status: AppStatus = { mode, maxInputChars: LIMITS.maxInputChars };
  return Response.json(status, { headers: { "Cache-Control": "no-store" } });
}
