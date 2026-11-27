import type {
  Ambiguity,
  Criterion,
  EdgeCase,
  ExportFile,
  HistoryReport,
  Plan,
  RankedScenario,
  Review,
  ScenarioInfo,
  StoryDoc,
  ValidationReport,
} from "@/lib/core/types";

export interface ReportInput {
  story: StoryDoc;
  plan: Plan;
  criteria: Criterion[];
  ambiguities: Ambiguity[];
  edgeCases: EdgeCase[];
  history?: HistoryReport;
  feature: string;
  featureName: string;
  scenarios: ScenarioInfo[];
  validation: ValidationReport;
  review?: Review;
  ranking: RankedScenario[];
}

const JIRA_PRIORITY: Record<string, string> = { P1: "High", P2: "Medium", P3: "Low" };

/**
 * Makes a value safe for a CSV cell. Besides quoting, it neutralises cells
 * that start with = + - @ (or a tab/CR), which spreadsheet apps would
 * otherwise run as formulas ("CSV injection").
 */
export function csvCell(value: string): string {
  let cell = value.replace(/\r\n?/g, "\n");
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return `"${cell.replace(/"/g, '""')}"`;
}

function mdCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
}

/**
 * Makes text safe inside a `//` comment in generated code. Every character
 * JavaScript treats as a line break (including U+2028 and U+2029) and every
 * control character becomes a space, so step text can never end the comment
 * and continue as code.
 */
export function commentSafe(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").trim();
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "feature"
  );
}

export function buildTestPlan(input: ReportInput): string {
  const { story, plan, criteria, ambiguities, edgeCases, history, validation, review, ranking } = input;
  const out: string[] = [];

  out.push(`# Test plan: ${story.title}`, "");
  if (story.url) out.push(`Source: ${story.url}`, "");
  out.push(`**Domain:** ${plan.domain}  `, `**Risk level:** ${plan.riskLevel}  `);
  out.push(`**Summary:** ${plan.summary}`, "");

  out.push("## Questions for the client", "");
  if (ambiguities.length === 0) {
    out.push("No ambiguities were found.", "");
  } else {
    ambiguities.forEach((item, index) => {
      out.push(`${index + 1}. **[${item.severity}] ${item.question}**`);
      if (item.quote) out.push(`   - Requirement says: "${item.quote}"`);
      out.push(`   - Why it matters: ${item.whyItMatters}`);
    });
    out.push("");
  }

  out.push("## Acceptance criteria", "", "| ID | Criterion | Source line |", "| --- | --- | --- |");
  for (const criterion of criteria) {
    const quote = criterion.sourceQuote ? `"${mdCell(criterion.sourceQuote)}"${criterion.quoteVerified ? "" : " (not found verbatim)"}` : "";
    out.push(`| ${criterion.id} | ${mdCell(criterion.text)} | ${quote} |`);
  }
  out.push("");

  if (edgeCases.length) {
    out.push("## Edge cases", "", "| ID | Severity | Category | Case | Expected | Criterion |", "| --- | --- | --- | --- | --- | --- |");
    for (const edgeCase of edgeCases) {
      out.push(
        `| ${edgeCase.id} | ${edgeCase.severity} | ${mdCell(edgeCase.category)} | ${mdCell(edgeCase.title)} | ${mdCell(edgeCase.expected)} | ${edgeCase.relatedAC} |`,
      );
    }
    out.push("");
  }

  if (history && history.lessons.length) {
    out.push(`## Lessons from past bugs in ${history.repo}`, "");
    for (const lesson of history.lessons) {
      const refs = lesson.issues.map((number) => `#${number}`).join(", ");
      out.push(`- ${lesson.lesson}${refs ? ` (${refs})` : ""}`);
    }
    out.push("");
  }

  out.push("## Scenarios by priority", "", "| Priority | Scenario | Covers | Why |", "| --- | --- | --- | --- |");
  for (const item of ranking) {
    const covers = item.tags.filter((tag) => /^@(AC|EC)-\d+$/i.test(tag)).join(" ");
    out.push(`| ${item.priority} | ${mdCell(item.scenario)} | ${covers} | ${mdCell(item.reason)} |`);
  }
  out.push("");

  const { stats } = validation;
  out.push("## Coverage", "");
  out.push(`- Scenarios: ${stats.scenarios} (${stats.steps} steps)`);
  out.push(`- Acceptance criteria covered: ${stats.acCovered} of ${stats.acTotal}`);
  out.push(`- Edge cases covered: ${stats.ecCovered} of ${stats.ecTotal}`);
  out.push(`- Automated checks: ${validation.ok ? "passed" : "NOT fully passed (see gaps below)"}`);
  out.push("");

  const gaps = [
    ...validation.parseErrors.map((error) => `Parse error at line ${error.line}: ${error.message}`),
    ...validation.uncoveredACs.map((id) => `${id} has no scenario.`),
    ...validation.uncoveredECs.map((id) => `High-severity edge case ${id} has no scenario.`),
    ...validation.stepIssues.map((issue) => `${issue.scenario}: ${issue.problem}`),
  ];
  if (gaps.length) {
    out.push("## Known gaps", "", ...gaps.map((gap) => `- ${gap}`), "");
  }

  if (review && review.issues.length) {
    out.push(review.addressed ? "## Reviewer notes (raised on the previous draft and addressed in this one)" : "## Reviewer notes", "");
    for (const issue of review.issues) {
      out.push(`- [${issue.severity}] ${issue.scenario}: ${issue.problem} Suggested fix: ${issue.fix}`);
    }
    out.push("");
  }

  out.push("---", "Generated by Spec Interrogator. Review before use: this is a draft for a QA engineer, not a replacement for one.");
  return out.join("\n");
}

export function buildPlaywrightSpec(input: ReportInput): string {
  const priorities = new Map(input.ranking.map((item) => [item.id, item.priority]));
  const out: string[] = [
    "import { test } from '@playwright/test';",
    "",
    "// Generated by Spec Interrogator from the .feature file.",
    "// Each test is marked fixme until its steps are implemented.",
    "",
    `test.describe(${JSON.stringify(input.featureName || input.story.title)}, () => {`,
  ];

  input.scenarios.forEach((scenario, index) => {
    const tags = [...scenario.tags.filter((tag) => /^@(AC|EC)-\d+$/i.test(tag))];
    const priority = priorities.get(scenario.id);
    if (priority) tags.push(`@${priority}`);

    if (index > 0) out.push("");
    out.push(`  test.fixme(${JSON.stringify(scenario.name)}, { tag: ${JSON.stringify(tags)} }, async ({ page }) => {`);
    out.push("    void page;");
    for (const step of scenario.steps) {
      out.push(`    // ${commentSafe(`${step.keyword} ${step.text}`)}`);
    }
    if (scenario.isOutline) out.push(`    // Scenario Outline: run once per Examples row (${scenario.exampleRows}).`);
    out.push("  });");
  });

  out.push("});", "");
  return out.join("\n");
}

export function buildJiraCsv(input: ReportInput): string {
  const rows: string[][] = [["Summary", "Issue Type", "Priority", "Labels", "Description"]];

  for (const item of input.ambiguities) {
    rows.push([
      `Clarify: ${item.term}`,
      "Task",
      item.severity === "high" ? "High" : item.severity === "medium" ? "Medium" : "Low",
      "needs-clarification",
      [`Question: ${item.question}`, item.quote ? `Requirement says: "${item.quote}"` : "", `Why it matters: ${item.whyItMatters}`]
        .filter(Boolean)
        .join("\n"),
    ]);
  }

  const scenarioById = new Map(input.scenarios.map((scenario) => [scenario.id, scenario]));
  for (const item of input.ranking) {
    const scenario = scenarioById.get(item.id);
    const steps = scenario ? scenario.steps.map((step) => `${step.keyword} ${step.text}`).join("\n") : "";
    const labels = ["test-case", ...item.tags.filter((tag) => /^@(AC|EC)-\d+$/i.test(tag)).map((tag) => tag.slice(1))];
    rows.push([
      `Test: ${item.scenario}`,
      "Test",
      JIRA_PRIORITY[item.priority] ?? "Medium",
      labels.join(" "),
      [`Priority reason: ${item.reason}`, "", steps].join("\n").trim(),
    ]);
  }

  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function buildExports(input: ReportInput): ExportFile[] {
  const base = slug(input.story.title || input.featureName);
  return [
    { name: `${base}-test-plan.md`, mime: "text/markdown", label: "Test plan", content: buildTestPlan(input) },
    { name: `${base}.feature`, mime: "text/plain", label: "Gherkin feature", content: input.feature.trimEnd() + "\n" },
    { name: `${base}.spec.ts`, mime: "text/plain", label: "Playwright stubs", content: buildPlaywrightSpec(input) },
    { name: `${base}-jira.csv`, mime: "text/csv", label: "Jira import CSV", content: buildJiraCsv(input) },
  ];
}
