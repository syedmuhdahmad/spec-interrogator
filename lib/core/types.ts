/**
 * Domain types shared by the server pipeline and the browser UI.
 * This file has no runtime imports, so it is safe on both sides.
 */

export type AgentId =
  | "intake"
  | "planner"
  | "analyst"
  | "ambiguity"
  | "edgecases"
  | "history"
  | "designer"
  | "validator"
  | "skeptic"
  | "ranker"
  | "reporter";

export type Severity = "high" | "medium" | "low";
export type Priority = "P1" | "P2" | "P3";
export type RunMode = "live" | "mock" | "recorded";

export type RunInput =
  | { kind: "text"; text: string; title?: string }
  | { kind: "github"; url: string };

export interface StoryDoc {
  source: "text" | "github";
  title: string;
  text: string;
  /** owner/repo when the story came from GitHub. */
  repo?: string;
  url?: string;
  truncated: boolean;
}

export interface Plan {
  domain: string;
  summary: string;
  focusAreas: string[];
  riskLevel: Severity;
  notes: string;
}

export interface Criterion {
  id: string;
  text: string;
  sourceQuote: string;
  /** True when sourceQuote was found in the story by a code check. */
  quoteVerified: boolean;
}

export interface Ambiguity {
  term: string;
  quote: string;
  whyItMatters: string;
  question: string;
  severity: Severity;
  quoteVerified: boolean;
}

export interface EdgeCase {
  id: string;
  title: string;
  category: string;
  relatedAC: string;
  severity: Severity;
  expected: string;
}

export interface IssueRef {
  number: number;
  title: string;
  url: string;
  labels: string[];
  snippet: string;
}

export interface HistoryLesson {
  lesson: string;
  issues: number[];
}

export interface HistoryReport {
  repo: string;
  queries: string[];
  matches: IssueRef[];
  lessons: HistoryLesson[];
  summary: string;
}

export interface ParseError {
  line: number;
  message: string;
}

export interface ScenarioInfo {
  /** Stable index-based id: S1, S2... */
  id: string;
  name: string;
  line: number;
  tags: string[];
  tagLine?: number;
  isOutline: boolean;
  exampleRows: number;
  /** The Examples tables of a Scenario Outline, one entry per Examples block. Absent when there are none. */
  examples?: ExamplesTable[];
  steps: { keyword: string; kind: string; text: string }[];
}

export interface ExamplesTable {
  header: string[];
  rows: string[][];
}

export interface StepIssue {
  scenario: string;
  line: number;
  problem: string;
}

export interface ValidationReport {
  ok: boolean;
  parseErrors: ParseError[];
  uncoveredACs: string[];
  uncoveredECs: string[];
  unknownTags: string[];
  stepIssues: StepIssue[];
  stats: {
    scenarios: number;
    steps: number;
    acCovered: number;
    acTotal: number;
    ecCovered: number;
    ecTotal: number;
  };
}

export interface ReviewIssue {
  scenario: string;
  problem: string;
  fix: string;
  severity: "major" | "minor";
}

export interface Review {
  verdict: "pass" | "revise";
  issues: ReviewIssue[];
  strengths: string[];
  /** True once the Test Designer's revision for these issues passed the checks. */
  addressed?: boolean;
}

export interface RankedScenario {
  id: string;
  scenario: string;
  priority: Priority;
  reason: string;
  tags: string[];
}

export interface ExportFile {
  name: string;
  mime: string;
  label: string;
  content: string;
}

export interface Artifacts {
  story: StoryDoc;
  plan: Plan;
  criteria: Criterion[];
  ambiguities: Ambiguity[];
  edgeCases: EdgeCase[];
  history: HistoryReport;
  feature: string;
  validation: ValidationReport;
  review: Review;
  ranking: RankedScenario[];
  exports: ExportFile[];
}

export type ArtifactKey = keyof Artifacts;

type ArtifactEvent = {
  [K in ArtifactKey]: { type: "artifact"; key: K; data: Artifacts[K] };
}[ArtifactKey];

export type RunEventBody =
  | { type: "run_start"; runId: string; mode: RunMode; source: "text" | "github"; title: string }
  | {
      type: "agent";
      agent: AgentId;
      status: "start" | "done" | "error" | "skipped";
      message?: string;
      ms?: number;
      model?: string;
      tokensIn?: number;
      tokensOut?: number;
      round?: number;
    }
  | { type: "tool"; agent: AgentId; tool: string; ok: boolean; message: string; ms?: number }
  | { type: "loop"; from: AgentId; to: AgentId; round: number; max: number; reason: string }
  | ArtifactEvent
  | { type: "ping" }
  | {
      type: "run_done";
      ms: number;
      llmCalls: number;
      tokensIn: number;
      tokensOut: number;
      estCostUsd: number;
      partial: boolean;
      note?: string;
    }
  | { type: "run_error"; message: string };

/** Every event carries `t`: milliseconds since the run started. */
export type RunEvent = RunEventBody & { t: number };

export type Emit = (event: RunEventBody) => void;
