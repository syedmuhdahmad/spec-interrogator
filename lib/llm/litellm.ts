import OpenAI from "openai";
import { UserFacingError } from "@/lib/core/errors";
import type { LlmClient, LlmRequest, LlmResponse } from "./types";

const REQUEST_TIMEOUT_MS = 100_000;

/**
 * Talks to the organisers' LiteLLM gateway, which speaks the OpenAI chat API.
 * The key is read from the server environment by the factory and never leaves
 * this process.
 */
export class LiteLlmClient implements LlmClient {
  readonly mode = "live" as const;
  private readonly client: OpenAI;

  constructor(options: { baseUrl: string; apiKey: string }) {
    this.client = new OpenAI({
      baseURL: options.baseUrl,
      apiKey: options.apiKey,
      timeout: REQUEST_TIMEOUT_MS,
      // The SDK backs off and retries 429s and 5xx responses on its own.
      maxRetries: 2,
    });
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    try {
      const completion = await this.client.chat.completions.create(
        {
          model: request.model,
          max_tokens: request.maxTokens,
          messages: [{ role: "system", content: request.system }, ...request.messages],
        },
        { signal: request.signal },
      );
      const choice = completion.choices[0];
      return {
        text: choice?.message?.content ?? "",
        tokensIn: completion.usage?.prompt_tokens ?? 0,
        tokensOut: completion.usage?.completion_tokens ?? 0,
        model: completion.model ?? request.model,
        truncated: choice?.finish_reason === "length",
      };
    } catch (error) {
      throw translateError(error);
    }
  }
}

/** Turns gateway failures into messages a visitor can act on, without leaking details. */
function translateError(error: unknown): Error {
  if (error instanceof OpenAI.APIUserAbortError) return error;

  if (error instanceof OpenAI.APIError) {
    const detail = `${error.status ?? "no-status"} ${error.message}`.slice(0, 300);
    console.error(`[llm] gateway error: ${detail}`);

    if (/budget|exceeded.*(limit|spend)|max.?budget/i.test(error.message)) {
      return new UserFacingError("The LLM budget for this app is used up, so live runs are paused.", 503);
    }
    if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) {
      return new UserFacingError("The LLM gateway rejected the app's API key. The app owner needs to check it.", 502);
    }
    if (error instanceof OpenAI.RateLimitError) {
      return new UserFacingError("The LLM gateway is rate-limiting requests. Please try again in a minute.", 429);
    }
    if (error instanceof OpenAI.APIConnectionTimeoutError) {
      return new UserFacingError("The model took too long to answer. Please try again.", 504);
    }
    if (error instanceof OpenAI.APIConnectionError) {
      return new UserFacingError("The LLM gateway could not be reached. Please try again.", 502);
    }
    if (error instanceof OpenAI.NotFoundError) {
      return new UserFacingError("The LLM gateway does not know the configured model name.", 502);
    }
    return new UserFacingError("The LLM gateway returned an error. Please try again.", 502);
  }
  return error instanceof Error ? error : new Error("Unknown LLM error");
}
