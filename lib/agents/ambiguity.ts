import { quoteAppearsIn } from "@/lib/core/json";
import { ambiguitiesSchema } from "@/lib/core/schemas";
import type { Ambiguity, Criterion, Plan, Severity, StoryDoc } from "@/lib/core/types";
import { formatCriteria } from "./analyst";
import { JSON_ONLY, runJsonAgent, systemPrompt, untrusted, type AgentContext } from "./base";

const SYSTEM = systemPrompt(
  "Ambiguity Hunter",
  `Find what is vague, undefined, contradictory or missing in the requirement, and write the question the team should ask the client for each.
Rules:
- Flag something only if the answer would change what gets built or how it is tested. Skip nitpicks.
- Typical finds: unmeasurable words ("fast", "secure", "reasonable"), undefined limits and units, unstated error behaviour, unclear actors or permissions, missing time zones, currencies or formats, and conflicts between sentences.
- "quote": copy the exact words from the requirement that are the problem. A code check will look for them in the text. If the problem is that something is not mentioned at all, use an empty string for "quote" and start "term" with "Missing: ".
- "question": one direct question a client can answer in a sentence, offering concrete options where that helps. At most 40 words.
- "whyItMatters": one sentence, at most 30 words.
- "term": at most 6 words.
- "severity": high when a wrong guess would cause rework or a production defect; low when a sensible default exists.
- Up to 8 items, most severe first.`,
  `${JSON_ONLY}
Shape:
{ "ambiguities": [ { "term": "the vague word or the missing topic", "quote": "exact words from the requirement, or empty", "whyItMatters": "what goes wrong if the team guesses", "question": "the question for the client", "severity": "high | medium | low" } ] }`,
);

const ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export async function runAmbiguityHunter(
  context: AgentContext,
  story: StoryDoc,
  plan: Plan,
  criteria: Criterion[],
): Promise<Ambiguity[]> {
  const result = await runJsonAgent(context, {
    agent: "ambiguity",
    system: SYSTEM,
    user: [
      `Domain: ${plan.domain}. Risk focus: ${plan.focusAreas.join("; ")}.`,
      untrusted("requirement", story.text),
      `Acceptance criteria already extracted:\n${formatCriteria(criteria)}`,
    ].join("\n\n"),
    schema: ambiguitiesSchema,
    describe: (value) => {
      const high = value.ambiguities.filter((item) => item.severity === "high").length;
      return `${value.ambiguities.length} questions for the client${high ? `, ${high} high severity` : ""}.`;
    },
  });

  return result.ambiguities
    .map((item) => ({
      ...item,
      // An empty quote is allowed for "Missing:" items; only a non-empty quote can fail the check.
      quoteVerified: item.quote === "" ? true : quoteAppearsIn(item.quote, story.text),
    }))
    .sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}
