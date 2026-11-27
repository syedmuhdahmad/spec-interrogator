import { planSchema } from "@/lib/core/schemas";
import type { Plan, StoryDoc } from "@/lib/core/types";
import { JSON_ONLY, runJsonAgent, systemPrompt, untrusted, type AgentContext } from "./base";

const SYSTEM = systemPrompt(
  "Planner",
  "Read the requirement and brief the specialist agents that follow you: what is being built, how risky it is, and where testers should look hardest.",
  `${JSON_ONLY}
Shape:
{
  "domain": "short label of 1 to 4 words, e.g. Payments, Healthcare scheduling, Authentication",
  "summary": "one sentence, at most 35 words: what is being built and for whom",
  "focusAreas": ["3 to 5 risk areas, most important first, each a phrase of at most 8 words"],
  "riskLevel": "high | medium | low (how costly a defect here would be)",
  "notes": "one sentence on anything unusual the other agents should know, or an empty string"
}`,
);

export async function runPlanner(context: AgentContext, story: StoryDoc): Promise<Plan> {
  return runJsonAgent(context, {
    agent: "planner",
    system: SYSTEM,
    user: untrusted("requirement", story.text),
    schema: planSchema,
    describe: (plan) => `${plan.domain}, ${plan.riskLevel} risk. Focus: ${plan.focusAreas.slice(0, 3).join("; ")}.`,
  });
}

/** Used when the Planner fails: the run continues with a neutral brief. */
export function fallbackPlan(story: StoryDoc): Plan {
  return {
    domain: "Software feature",
    summary: story.title,
    focusAreas: ["Input validation", "Error handling", "Permissions"],
    riskLevel: "medium",
    notes: "",
  };
}
