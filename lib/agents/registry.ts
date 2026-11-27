import type { AgentId } from "@/lib/core/types";

/**
 * Static facts about each pipeline step. No server imports, so the UI can
 * read the same list the orchestrator uses.
 */

export type ModelTier = "main" | "fast";

export interface AgentSpec {
  id: AgentId;
  name: string;
  /** One word, for tight spaces such as the roster strip. */
  short: string;
  /** "llm" steps call a model; "code" steps are deterministic TypeScript. */
  kind: "llm" | "code";
  tier?: ModelTier;
  maxTokens?: number;
  blurb: string;
}

export const AGENTS: readonly AgentSpec[] = [
  {
    id: "intake",
    name: "Intake",
    short: "Intake",
    kind: "code",
    blurb: "Reads the pasted story, or fetches the public GitHub issue.",
  },
  {
    id: "planner",
    name: "Planner",
    short: "Planner",
    kind: "llm",
    tier: "main",
    maxTokens: 900,
    blurb: "Sizes up the requirement and sets the risk focus for the other agents.",
  },
  {
    id: "analyst",
    name: "Analyst",
    short: "Analyst",
    kind: "llm",
    tier: "fast",
    maxTokens: 1800,
    blurb: "Extracts testable acceptance criteria, each tied to a quoted line.",
  },
  {
    id: "ambiguity",
    name: "Ambiguity Hunter",
    short: "Hunter",
    kind: "llm",
    tier: "main",
    maxTokens: 3000,
    blurb: "Finds vague or missing requirements and writes the questions to ask the client.",
  },
  {
    id: "edgecases",
    name: "Edge-Case Explorer",
    short: "Explorer",
    kind: "llm",
    tier: "fast",
    maxTokens: 2600,
    blurb: "Lists boundaries, error paths, permissions and state problems.",
  },
  {
    id: "history",
    name: "History Scout",
    short: "Scout",
    kind: "llm",
    tier: "fast",
    maxTokens: 1400,
    blurb: "Chooses search terms, searches the repo's closed bugs, and extracts lessons.",
  },
  {
    id: "designer",
    name: "Test Designer",
    short: "Designer",
    kind: "llm",
    tier: "main",
    maxTokens: 6000,
    blurb: "Writes the Gherkin suite, and rewrites it when the checks or the Skeptic object.",
  },
  {
    id: "validator",
    name: "Validator",
    short: "Validator",
    kind: "code",
    blurb: "Parses the Gherkin and checks every criterion is covered. Sends failures back.",
  },
  {
    id: "skeptic",
    name: "Skeptic",
    short: "Skeptic",
    kind: "llm",
    tier: "main",
    maxTokens: 2200,
    blurb: "Attacks the suite: weak assertions, missing negatives, duplicates.",
  },
  {
    id: "ranker",
    name: "Risk Ranker",
    short: "Ranker",
    kind: "llm",
    tier: "fast",
    maxTokens: 2200,
    blurb: "Sets a priority for each scenario, with a reason.",
  },
  {
    id: "reporter",
    name: "Reporter",
    short: "Reporter",
    kind: "code",
    blurb: "Builds the test plan, .feature file, Playwright stubs and Jira CSV.",
  },
] as const;

const BY_ID = new Map<AgentId, AgentSpec>(AGENTS.map((spec) => [spec.id, spec]));

export function agentSpec(id: AgentId): AgentSpec {
  const spec = BY_ID.get(id);
  if (!spec) throw new Error(`Unknown agent: ${id}`);
  return spec;
}

export function agentName(id: AgentId): string {
  return BY_ID.get(id)?.name ?? id;
}
