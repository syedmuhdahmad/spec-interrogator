import type { AgentId } from "@/lib/core/types";

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  agent: AgentId;
  model: string;
  maxTokens: number;
  system: string;
  messages: LlmMessage[];
  signal?: AbortSignal;
}

export interface LlmResponse {
  text: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
  /** True when the model stopped because it hit maxTokens. */
  truncated: boolean;
}

/**
 * The only thing agents know about the model provider. The LiteLLM client and
 * the mock client both implement it, so agents and the orchestrator never
 * depend on a vendor SDK.
 */
export interface LlmClient {
  readonly mode: "live" | "mock";
  complete(request: LlmRequest): Promise<LlmResponse>;
}
