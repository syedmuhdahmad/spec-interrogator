import { edgeCasesSchema } from "@/lib/core/schemas";
import type { Criterion, EdgeCase, Plan, StoryDoc } from "@/lib/core/types";
import { formatCriteria } from "./analyst";
import { JSON_ONLY, runJsonAgent, systemPrompt, untrusted, type AgentContext } from "./base";

const SYSTEM = systemPrompt(
  "Edge-Case Explorer",
  `List the edge cases a careful tester would try for this requirement.
Rules:
- Think through: boundary values, empty and invalid input, error and timeout paths, permissions and roles, repeated or simultaneous actions, state left behind after a failure, and locale (time zone, currency, language) where relevant.
- Each case must be specific to this requirement, not a generic checklist line.
- "relatedAC": the id of the acceptance criterion it stresses (for example "AC-2").
- "expected": what the system should do. If the requirement does not say, write "Not specified: needs a decision".
- "severity": high when a failure would lose data, money or access, or block the main flow.
- Between 4 and 8 cases, highest severity first.`,
  `${JSON_ONLY}
Shape:
{ "edgeCases": [ { "title": "short name of the case", "category": "boundary | validation | error | permissions | concurrency | state | locale", "relatedAC": "AC-n", "severity": "high | medium | low", "expected": "what should happen" } ] }`,
);

export async function runEdgeCaseExplorer(
  context: AgentContext,
  story: StoryDoc,
  plan: Plan,
  criteria: Criterion[],
): Promise<EdgeCase[]> {
  const result = await runJsonAgent(context, {
    agent: "edgecases",
    system: SYSTEM,
    user: [
      `Domain: ${plan.domain}. Risk focus: ${plan.focusAreas.join("; ")}.`,
      untrusted("requirement", story.text),
      `Acceptance criteria:\n${formatCriteria(criteria)}`,
    ].join("\n\n"),
    schema: edgeCasesSchema,
    describe: (value) => {
      const high = value.edgeCases.filter((item) => item.severity === "high").length;
      return `${value.edgeCases.length} edge cases${high ? `, ${high} high severity` : ""}.`;
    },
  });

  const knownIds = new Set(criteria.map((criterion) => criterion.id));
  return result.edgeCases.map((edgeCase, index) => {
    const related = edgeCase.relatedAC.toUpperCase();
    return {
      id: `EC-${index + 1}`,
      title: edgeCase.title,
      category: edgeCase.category.toLowerCase(),
      // A criterion id the model made up is dropped rather than passed on.
      relatedAC: knownIds.has(related) ? related : "",
      severity: edgeCase.severity,
      expected: edgeCase.expected,
    };
  });
}

export function formatEdgeCases(edgeCases: EdgeCase[]): string {
  return edgeCases
    .map((edgeCase) => `${edgeCase.id} [${edgeCase.severity}] ${edgeCase.title} -> ${edgeCase.expected}`)
    .join("\n");
}
