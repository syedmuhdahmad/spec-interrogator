/**
 * Single source of truth for environment settings and run limits.
 * Server-only: never import this from a client component.
 */

export type DemoMode = "live" | "replay";

export interface ModelPrice {
  /** USD per million input tokens. */
  inPerM: number;
  /** USD per million output tokens. */
  outPerM: number;
}

export interface Limits {
  /** Longest story (characters) accepted from a user or fetched from GitHub. */
  maxInputChars: number;
  /** Shortest story worth analysing. */
  minInputChars: number;
  /** Validator -> Test Designer fix rounds. */
  maxFixRounds: number;
  /** Skeptic -> Test Designer revision rounds. */
  maxReviseRounds: number;
  /** GitHub searches the History Scout may run. */
  maxHistorySearches: number;
  /** Soft deadline: optional steps are skipped once this little time is left. */
  runDeadlineMs: number;
  /** Time an optional step needs to be worth starting. */
  optionalStepReserveMs: number;
  /** Hard stop: the run is aborted at this point. */
  runHardStopMs: number;
  /** Total tokens (in + out) one run may spend before it is stopped. */
  maxRunTokens: number;
  /** Time kept back before the hard stop so the Reporter can still build the files. */
  finishReserveMs: number;
}

export const LIMITS: Limits = {
  maxInputChars: 8_000,
  minInputChars: 40,
  maxFixRounds: 2,
  maxReviseRounds: 1,
  maxHistorySearches: 2,
  runDeadlineMs: 250_000,
  optionalStepReserveMs: 70_000,
  runHardStopMs: 285_000,
  maxRunTokens: 90_000,
  finishReserveMs: 8_000,
};

export const RATE_LIMITS = {
  /**
   * Runs one IP address may start per window. Kept loose on purpose: several
   * judges may share one office address.
   */
  perIpRuns: 6,
  perIpWindowMs: 10 * 60_000,
  /** Runs this server instance will start per window, across all visitors. */
  globalRuns: 20,
  globalWindowMs: 60 * 60_000,
  /** Runs this instance will execute at once (LiteLLM allows 60 requests a minute). */
  maxConcurrentRuns: 4,
} as const;

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export interface ServerConfig {
  baseUrl?: string;
  apiKey?: string;
  mainModel: string;
  fastModel: string;
  githubToken?: string;
  demoMode: DemoMode;
  mockLlm: boolean;
  /** True when live LLM calls can be made. */
  configured: boolean;
  /** Set when a setting is present but unusable; shown to the operator, never the key. */
  configError?: string;
}

export function getServerConfig(): ServerConfig {
  const baseUrl = readEnv("LITELLM_BASE_URL")?.replace(/\/+$/, "");
  const apiKey = readEnv("LITELLM_API_KEY");
  const mockLlm = readEnv("MOCK_LLM") === "1";
  const demoMode: DemoMode = readEnv("DEMO_MODE") === "replay" ? "replay" : "live";

  let configError: string | undefined;
  if (baseUrl && !/^https:\/\//i.test(baseUrl)) {
    configError = "LITELLM_BASE_URL must start with https://";
  }

  return {
    baseUrl,
    apiKey,
    mainModel: readEnv("LITELLM_MODEL") ?? "claude-sonnet-5-5",
    fastModel: readEnv("LITELLM_MODEL_FAST") ?? "claude-haiku",
    githubToken: readEnv("GITHUB_TOKEN"),
    demoMode,
    mockLlm,
    configured: mockLlm || (Boolean(baseUrl && apiKey) && !configError),
    configError,
  };
}

/**
 * Prices used only for the on-screen cost estimate. They are assumptions, not
 * billing data: the LiteLLM dashboard is the source of truth for real spend.
 * Override with PRICE_MAIN / PRICE_FAST as "input,output" USD per million tokens.
 */
export function getModelPrices(): { main: ModelPrice; fast: ModelPrice } {
  return {
    main: parsePrice(readEnv("PRICE_MAIN"), { inPerM: 3, outPerM: 15 }),
    fast: parsePrice(readEnv("PRICE_FAST"), { inPerM: 1, outPerM: 5 }),
  };
}

function parsePrice(raw: string | undefined, fallback: ModelPrice): ModelPrice {
  if (!raw) return fallback;
  const [inPerM, outPerM] = raw.split(",").map((part) => Number(part.trim()));
  if (!Number.isFinite(inPerM) || !Number.isFinite(outPerM) || inPerM < 0 || outPerM < 0) {
    return fallback;
  }
  return { inPerM, outPerM };
}
