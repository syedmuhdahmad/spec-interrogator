import type { Ambiguity, Criterion, EdgeCase, HistoryReport, Plan, ReviewIssue, StoryDoc, ValidationReport } from "@/lib/core/types";
import { formatAmbiguities } from "./ambiguity";
import { formatCriteria } from "./analyst";
import { runFencedAgent, systemPrompt, untrusted, type AgentContext } from "./base";
import { formatEdgeCases } from "./edgecases";

const REPLY_FORMAT = "Reply with the complete feature file in one ```gherkin code block and nothing else.";

const SYSTEM = systemPrompt(
  "Test Designer",
  `Write a Gherkin feature file that tests the requirement. Automated checks will parse your file and verify coverage, and a reviewer will then attack it, so follow the rules exactly.
Rules:
- One Feature. Between 6 and 10 scenarios. Keep the file under 110 lines: a longer file is cut off and rejected.
- One scenario may verify several criteria when a single flow shows them all: tag it with each one.
- At most 6 steps per scenario and at most 4 rows in an Examples table.
- Tag every scenario with the acceptance criteria it verifies (@AC-1) and any edge case it covers (@EC-2). Tags go on the line directly above the scenario and nowhere else.
- Every acceptance criterion must have at least one scenario. Every edge case marked [high] must have one.
- Use only AC and EC ids from the lists you are given.
- Every scenario needs a When step (one action) and a Then step. A Then step must assert something a tester can observe: a message, a value, a saved state. Never "it works" or "it is handled correctly".
- Include negative scenarios: for the main flows, show what happens when the action fails or is refused, and what state is left behind.
- Use a Scenario Outline with an Examples table for boundary values.
- Do not invent business rules. Where the requirement leaves a value or an outcome undefined, write the step with a placeholder such as "<TBD: maximum amount>" or "<TBD: what the customer is told>". Code tags every scenario that contains a placeholder, so do not write @needs-clarification yourself.
- The open questions you are given are undecided. Never write a step that assumes an answer to one: use a <TBD: ...> placeholder in that step instead.
- An edge case whose expected result is "Not specified: needs a decision" gets a Then step with a <TBD: ...> placeholder.
- A criterion that is vague or about quality ("fast", "secure") still needs its own scenario: write it with <TBD: ...> placeholders rather than leaving it out.
- A placeholder stands for the undecided part only. Where the requirement states part of an outcome, assert that part plainly and use a placeholder for the rest. Do not write a scenario whose Then steps are all placeholders unless nothing about its outcome is stated.
- A Then step says what a tester can see or measure. Never write how the system is built (a lock, a key, an internal mechanism) as a Then step.
- Do not add priority tags: another agent assigns priorities.
- Plain, concrete steps in business language. No UI selectors.`,
  REPLY_FORMAT,
);

export interface DesignBrief {
  story: StoryDoc;
  plan: Plan;
  criteria: Criterion[];
  edgeCases: EdgeCase[];
  /** Questions nobody has answered yet: the suite must not assume an answer to any of them. */
  ambiguities: Ambiguity[];
  history?: HistoryReport;
}

/** What the Test Designer is being asked to do on this round. */
export type DesignTask =
  | { kind: "initial" }
  /** The file is sound but leaves criteria or edge cases uncovered: write only the missing scenarios. */
  | { kind: "extend"; previous: string; report: ValidationReport }
  /** The file is broken (does not parse, or has malformed scenarios): rewrite it. */
  | { kind: "fix"; previous: string; report: ValidationReport }
  | { kind: "revise"; previous: string; issues: ReviewIssue[] };

function briefText(brief: DesignBrief): string {
  const parts = [
    `Domain: ${brief.plan.domain}. Risk focus: ${brief.plan.focusAreas.join("; ")}.`,
    untrusted("requirement", brief.story.text),
    `Acceptance criteria:\n${formatCriteria(brief.criteria)}`,
  ];
  if (brief.edgeCases.length) parts.push(`Edge cases:\n${formatEdgeCases(brief.edgeCases)}`);
  if (brief.ambiguities.length) {
    parts.push(`Open questions for the client (undecided):\n${formatAmbiguities(brief.ambiguities)}`);
  }
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
  if (task.kind === "extend") {
    return [
      previous,
      `The file is valid, but the automated coverage check found gaps:\n${fixInstructions(task.report, criteria)}`,
      "Write ONLY the new scenarios that close these gaps: each one a tag line followed by its Scenario. They will be appended to the file as it is. Do not repeat the Feature line, the Background or any existing scenario, and do not reuse an existing scenario name.",
    ].join("\n\n");
  }
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
    "Address each problem and keep all existing coverage and tags. Keep every <TBD: ...> placeholder: do not replace one with a guessed value. A scenario that holds a placeholder for an open question is kept too: do not drop it. Send the complete revised file.",
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
      : task.kind === "extend"
        ? "Adding scenarios for what the Validator found uncovered."
        : task.kind === "fix"
          ? "Fixing what the Validator rejected."
          : "Revising after the Skeptic's review.";

  if (task.kind === "extend") {
    const addition = await runFencedAgent(context, {
      agent: "designer",
      round,
      system: SYSTEM.replace(REPLY_FORMAT, "Reply with only the new scenarios in one ```gherkin code block and nothing else."),
      user: `${briefText(brief)}\n\n${taskText(task, brief.criteria)}`,
      startMessage,
      validate: (body) => {
        if (!/^\s*(Scenario Outline|Scenario Template|Scenario|Example):/m.test(body)) throw new Error("The reply must contain at least one Scenario.");
      },
      describe: (body) => `${countScenarios(body)} scenario(s) added.`,
    });
    return appendScenarios(task.previous, addition);
  }

  return runFencedAgent(context, {
    agent: "designer",
    round,
    system: SYSTEM,
    user: `${briefText(brief)}\n\n${taskText(task, brief.criteria)}`,
    startMessage,
    validate: (body) => {
      if (!/^\s*(@\S+\s+)*Feature:/m.test(body)) throw new Error("The file must contain a 'Feature:' line.");
    },
    describe: (feature) => `${countScenarios(feature)} scenarios, ${feature.split("\n").length} lines.`,
  });
}

function countScenarios(text: string): number {
  return (text.match(/^\s*(Scenario Outline|Scenario Template|Scenario|Example):/gm) ?? []).length;
}

/**
 * Appends new scenarios to an existing feature. If the model repeated the
 * Feature header anyway, everything before the first tag or scenario is
 * dropped, and the block is re-indented to sit under the Feature.
 */
export function appendScenarios(feature: string, addition: string): string {
  const lines = addition.replace(/\r/g, "").split("\n");
  const start = lines.findIndex((line) => /^\s*(@\S|Scenario Outline:|Scenario Template:|Scenario:|Example:)/.test(line));
  const body = start === -1 ? lines : lines.slice(start);
  const indents = body.filter((line) => line.trim()).map((line) => /^\s*/.exec(line)?.[0].length ?? 0);
  const shift = 2 - Math.min(...indents, Number.MAX_SAFE_INTEGER);
  const shifted = body.map((line) => {
    if (!line.trim()) return "";
    return shift >= 0 ? " ".repeat(shift) + line : line.slice(Math.min(-shift, /^\s*/.exec(line)?.[0].length ?? 0));
  });
  return `${feature.trimEnd()}\n\n${shifted.join("\n").trimEnd()}\n`;
}
