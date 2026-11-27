import type { Criterion, EdgeCase, HistoryReport, Plan, ReviewIssue, StoryDoc, ValidationReport } from "@/lib/core/types";
import { formatCriteria } from "./analyst";
import { runFencedAgent, systemPrompt, untrusted, type AgentContext } from "./base";
import { formatEdgeCases } from "./edgecases";

const SYSTEM = systemPrompt(
  "Test Designer",
  `Write a Gherkin feature file that tests the requirement. Automated checks will parse your file and verify coverage, and a reviewer will then attack it, so follow the rules exactly.
Rules:
- One Feature. Between 6 and 12 scenarios. Keep the file under 130 lines.
- Tag every scenario with the acceptance criteria it verifies (@AC-1) and any edge case it covers (@EC-2). Tags go on the line directly above the scenario.
- Every acceptance criterion must have at least one scenario. Every edge case marked [high] must have one.
- Use only AC and EC ids from the lists you are given.
- Every scenario needs a When step (one action) and a Then step. A Then step must assert something a tester can observe: a message, a value, a saved state. Never "it works" or "it is handled correctly".
- Include negative scenarios: for the main flows, show what happens when the action fails or is refused, and what state is left behind.
- Use a Scenario Outline with an Examples table for boundary values.
- Do not invent business rules. Where the requirement leaves a value undefined, write the step with a placeholder such as "<TBD: maximum amount>" and add the tag @needs-clarification.
- Do not add priority tags: another agent assigns priorities.
- Plain, concrete steps in business language. No UI selectors.`,
  "Reply with the complete feature file in one ```gherkin code block and nothing else.",
);

export interface DesignBrief {
  story: StoryDoc;
  plan: Plan;
  criteria: Criterion[];
  edgeCases: EdgeCase[];
  history?: HistoryReport;
}

/** What the Test Designer is being asked to do on this round. */
export type DesignTask =
  | { kind: "initial" }
  | { kind: "fix"; previous: string; report: ValidationReport }
  | { kind: "revise"; previous: string; issues: ReviewIssue[] };

function briefText(brief: DesignBrief): string {
  const parts = [
    `Domain: ${brief.plan.domain}. Risk focus: ${brief.plan.focusAreas.join("; ")}.`,
    untrusted("requirement", brief.story.text),
    `Acceptance criteria:\n${formatCriteria(brief.criteria)}`,
  ];
  if (brief.edgeCases.length) parts.push(`Edge cases:\n${formatEdgeCases(brief.edgeCases)}`);
  if (brief.history?.lessons.length) {
    parts.push(`Lessons from past bugs in this repository:\n${brief.history.lessons.map((l) => `- ${l.lesson}`).join("\n")}`);
  }
  return parts.join("\n\n");
}

function fixInstructions(report: ValidationReport, criteria: Criterion[]): string {
  const lines: string[] = [];
  for (const error of report.parseErrors) lines.push(`- Line ${error.line}: ${error.message}`);
  for (const id of report.uncoveredACs) {
    const criterion = criteria.find((item) => item.id === id);
    lines.push(`- ${id} has no scenario${criterion ? `: "${criterion.text}"` : ""}. Add one tagged @${id}.`);
  }
  for (const id of report.uncoveredECs) lines.push(`- High-severity edge case ${id} has no scenario. Add one tagged @${id}.`);
  for (const issue of report.stepIssues) lines.push(`- Scenario "${issue.scenario}" (line ${issue.line}): ${issue.problem}`);
  return lines.join("\n");
}

function taskText(task: DesignTask, criteria: Criterion[]): string {
  if (task.kind === "initial") return "Write the feature file.";

  const previous = `Your previous feature file:\n\`\`\`gherkin\n${task.previous}\n\`\`\``;
  if (task.kind === "fix") {
    return [
      previous,
      `The automated checks rejected it:\n${fixInstructions(task.report, criteria)}`,
      "Fix every item above and keep everything that was already correct. Send the complete corrected file.",
    ].join("\n\n");
  }
  return [
    previous,
    `The reviewer raised these problems:\n${task.issues.map((issue) => `- [${issue.severity}] "${issue.scenario}": ${issue.problem} Fix: ${issue.fix}`).join("\n")}`,
    "Address each problem and keep all existing coverage and tags. Send the complete revised file.",
  ].join("\n\n");
}

export async function runTestDesigner(
  context: AgentContext,
  brief: DesignBrief,
  task: DesignTask,
  round: number,
): Promise<string> {
  const startMessage =
    task.kind === "initial"
      ? "Writing the first draft."
      : task.kind === "fix"
        ? "Fixing what the Validator rejected."
        : "Revising after the Skeptic's review.";

  return runFencedAgent(context, {
    agent: "designer",
    round,
    system: SYSTEM,
    user: `${briefText(brief)}\n\n${taskText(task, brief.criteria)}`,
    startMessage,
    validate: (body) => {
      if (!/^\s*(@\S+\s+)*Feature:/m.test(body)) throw new Error("The file must contain a 'Feature:' line.");
    },
    describe: (feature) => {
      const scenarios = (feature.match(/^\s*(Scenario Outline|Scenario Template|Scenario|Example):/gm) ?? []).length;
      return `${scenarios} scenarios, ${feature.split("\n").length} lines.`;
    },
  });
}
