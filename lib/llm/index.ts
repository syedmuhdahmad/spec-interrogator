import type { ServerConfig } from "@/lib/config";
import { UserFacingError } from "@/lib/core/errors";
import { LiteLlmClient } from "./litellm";
import { MockLlmClient } from "./mock";
import type { LlmClient } from "./types";

export type { LlmClient, LlmMessage, LlmRequest, LlmResponse } from "./types";

/** Chooses the model client for a run. One instance per run. */
export function createLlmClient(config: ServerConfig): LlmClient {
  if (config.mockLlm) return new MockLlmClient();
  if (config.configError) throw new UserFacingError(`The app is misconfigured: ${config.configError}.`, 503);
  if (!config.baseUrl || !config.apiKey) {
    throw new UserFacingError(
      "Live runs are not set up yet: the app owner needs to add the LiteLLM settings in Vercel.",
      503,
    );
  }
  return new LiteLlmClient({ baseUrl: config.baseUrl, apiKey: config.apiKey });
}
