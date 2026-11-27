import { rankingSchema } from "@/lib/core/schemas";
import type { Ambiguity, HistoryReport, Plan, Priority, RankedScenario, ScenarioInfo } from "@/lib/core/types";
import { JSON_ONLY, runJsonAgent, type AgentContext } from "./base";

const SYSTEM = [
  "You are the Risk Ranker agent in Spec Interrogator, a pipeline that helps QA engineers analyse a software requirement before development starts.",
  `Give each test scenario a priority so a team short on time knows what to run first.
Rules:
- P1: a failure blocks the main flow, or loses data, money or access. P2: important behaviour with a workaround. P3: polish and rare cases.
- Raise the priority of scenarios in areas where past bugs were found, and of scenarios that depend on an unanswered question (they are the likeliest to be built wrong).
- Not everything is P1: at most about a third of the scenarios.
- Rank every scenario id you are given, once.
- "reason": one sentence of at most 15 words, specific to that scenario.`,
  `${JSON_ONLY}
Shape:
{ "ranking": [ { "id": "S1", "priority": "P1 | P2 | P3", "reason": "why" } ] }`,
].join("\n\n");

const ORDER: Record<Priority, number> = { P1: 0, P2: 1, P3: 2 };

export async function runRiskRanker(
  context: AgentContext,
  scenarios: ScenarioInfo[],
  plan: Plan,
  ambiguities: Ambiguity[],
  history?: HistoryReport,
): Promise<RankedScenario[]> {
  const listing = scenarios.map((scenario) => `${scenario.id}: ${scenario.name} ${scenario.tags.join(" ")}`).join("\n");
  const context_ = [
    `Domain: ${plan.domain}. Overall risk: ${plan.riskLevel}. Focus: ${plan.focusAreas.join("; ")}.`,
    `Scenarios:\n${listing}`,
  ];
  if (ambiguities.length) {
    context_.push(`Open questions for the client:\n${ambiguities.map((a) => `- [${a.severity}] ${a.term}`).join("\n")}`);
  }
  if (history?.lessons.length) {
    context_.push(`Past bugs in this repository:\n${history.lessons.map((l) => `- ${l.lesson}`).join("\n")}`);
  }

  const result = await runJsonAgent(context, {
    agent: "ranker",
    system: SYSTEM,
    user: context_.join("\n\n"),
    schema: rankingSchema,
    describe: (value) => {
      const p1 = value.ranking.filter((item) => item.priority === "P1").length;
      return `${value.ranking.length} scenarios ranked, ${p1} at P1.`;
    },
  });

  const byId = new Map(result.ranking.map((item) => [item.id.toUpperCase(), item]));
  return mergeRanking(scenarios, (id) => byId.get(id));
}

/** Used when the Ranker fails: every scenario gets the middle priority. */
export function fallbackRanking(scenarios: ScenarioInfo[]): RankedScenario[] {
  return mergeRanking(scenarios, () => undefined);
}

function mergeRanking(
  scenarios: ScenarioInfo[],
  lookup: (id: string) => { priority: Priority; reason: string } | undefined,
): RankedScenario[] {
  return scenarios
    .map((scenario) => {
      const ranked = lookup(scenario.id);
      return {
        id: scenario.id,
        scenario: scenario.name,
        priority: ranked?.priority ?? "P2",
        reason: ranked?.reason ?? "Not ranked by the agent; default priority.",
        tags: scenario.tags,
      };
    })
    .sort((a, b) => ORDER[a.priority] - ORDER[b.priority]);
}
