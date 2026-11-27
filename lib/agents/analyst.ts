import { quoteAppearsIn } from "@/lib/core/json";
import { criteriaSchema } from "@/lib/core/schemas";
import type { Criterion, Plan, StoryDoc } from "@/lib/core/types";
import { JSON_ONLY, runJsonAgent, systemPrompt, untrusted, type AgentContext } from "./base";

const SYSTEM = systemPrompt(
  "Analyst",
  `Extract the acceptance criteria: the distinct, testable behaviours the requirement asks for.
Rules:
- One behaviour per criterion, written so a tester could pass or fail it.
- Only what the requirement states or directly implies. Do not invent rules, limits or numbers. Where the requirement is vague, keep its vague wording: another agent handles ambiguity.
- For each criterion, copy the exact words from the requirement that it comes from into "sourceQuote". Copy them character for character; a code check will look for them in the text.
- Keep the actor the requirement names. If it lists a task without saying who or what performs it, describe the task without assigning it to "the system".
- Do not add qualifiers the text does not contain, such as "successfully", "correctly" or "always".
- If the requirement has its own list of acceptance criteria, base the criteria on that list first. Add items from the rest of the text only when they are testable behaviours the list leaves out.
- Between 3 and 8 criteria. Merge near-duplicates.
- Each criterion is one sentence of at most 25 words.`,
  `${JSON_ONLY}
Shape:
{ "criteria": [ { "text": "one testable behaviour, with the actor the requirement names", "sourceQuote": "exact words from the requirement" } ] }`,
);

export async function runAnalyst(context: AgentContext, story: StoryDoc, plan: Plan): Promise<Criterion[]> {
  const result = await runJsonAgent(context, {
    agent: "analyst",
    system: SYSTEM,
    user: `Domain: ${plan.domain}\n\n${untrusted("requirement", story.text)}`,
    schema: criteriaSchema,
    describe: (value) => `${value.criteria.length} acceptance criteria extracted.`,
  });

  // Ids are assigned here, not by the model, so every later reference is reliable.
  return result.criteria.map((criterion, index) => ({
    id: `AC-${index + 1}`,
    text: criterion.text,
    sourceQuote: criterion.sourceQuote,
    quoteVerified: quoteAppearsIn(criterion.sourceQuote, story.text),
  }));
}

export function formatCriteria(criteria: Criterion[]): string {
  return criteria.map((criterion) => `${criterion.id}: ${criterion.text}`).join("\n");
}
