import type { Criterion, EdgeCase, StepIssue, ValidationReport } from "@/lib/core/types";
import type { ParsedFeature } from "./gherkin";

/**
 * Checks a parsed feature against the criteria and edge cases it is supposed
 * to cover. This is plain code on purpose: coverage is a fact to compute, not
 * an opinion to ask a model for.
 *
 * A suite passes when it parses, every acceptance criterion and every
 * high-severity edge case has at least one tagged scenario, and no scenario
 * is structurally broken.
 */
export function checkCoverage(
  parsed: ParsedFeature,
  criteria: Criterion[],
  edgeCases: EdgeCase[],
): ValidationReport {
  const acIds = criteria.map((criterion) => criterion.id.toUpperCase());
  const ecIds = edgeCases.map((edgeCase) => edgeCase.id.toUpperCase());
  const requiredEcIds = edgeCases
    .filter((edgeCase) => edgeCase.severity === "high")
    .map((edgeCase) => edgeCase.id.toUpperCase());

  if (!parsed.ok) {
    return {
      ok: false,
      parseErrors: parsed.errors,
      uncoveredACs: criteria.map((criterion) => criterion.id),
      uncoveredECs: requiredEcIds,
      unknownTags: [],
      stepIssues: [],
      stats: { scenarios: 0, steps: 0, acCovered: 0, acTotal: acIds.length, ecCovered: 0, ecTotal: ecIds.length },
    };
  }

  const usedTags = new Set<string>();
  const stepIssues: StepIssue[] = [];
  const seenNames = new Map<string, number>();
  let stepCount = 0;

  for (const scenario of parsed.scenarios) {
    scenario.tags.forEach((tag) => usedTags.add(tag.replace(/^@/, "").toUpperCase()));
    stepCount += scenario.steps.length;
    const issue = (problem: string) => stepIssues.push({ scenario: scenario.name, line: scenario.line, problem });

    if (!scenario.name) issue("The scenario has no name.");
    if (scenario.steps.length === 0) {
      issue("The scenario has no steps.");
    } else {
      if (!scenario.steps.some((step) => step.kind === "Action")) issue("There is no When step: nothing is being done.");
      if (!scenario.steps.some((step) => step.kind === "Outcome")) issue("There is no Then step: nothing is being checked.");
    }
    if (scenario.isOutline && scenario.exampleRows === 0) issue("Scenario Outline has no Examples rows.");

    const key = scenario.name.toLowerCase();
    if (key && seenNames.has(key)) issue(`Duplicate scenario name (also at line ${seenNames.get(key)}).`);
    else if (key) seenNames.set(key, scenario.line);

    const linksToCriterion = scenario.tags.some((tag) => /^@AC-\d+$/i.test(tag));
    if (!linksToCriterion) issue("No @AC-n tag: the scenario is not linked to an acceptance criterion.");
  }

  if (parsed.scenarios.length === 0) {
    stepIssues.push({ scenario: parsed.featureName, line: 1, problem: "The feature has no scenarios." });
  }

  const uncoveredACs = criteria.filter((criterion) => !usedTags.has(criterion.id.toUpperCase())).map((c) => c.id);
  const uncoveredECs = edgeCases
    .filter((edgeCase) => edgeCase.severity === "high" && !usedTags.has(edgeCase.id.toUpperCase()))
    .map((edgeCase) => edgeCase.id);

  const known = new Set([...acIds, ...ecIds]);
  const unknownTags = [...usedTags].filter((tag) => /^(AC|EC)-\d+$/.test(tag) && !known.has(tag)).map((tag) => `@${tag}`);
  for (const tag of unknownTags) {
    stepIssues.push({ scenario: parsed.featureName, line: 1, problem: `${tag} does not match any criterion or edge case.` });
  }

  return {
    ok: uncoveredACs.length === 0 && uncoveredECs.length === 0 && stepIssues.length === 0,
    parseErrors: [],
    uncoveredACs,
    uncoveredECs,
    unknownTags,
    stepIssues,
    stats: {
      scenarios: parsed.scenarios.length,
      steps: stepCount,
      acCovered: acIds.filter((id) => usedTags.has(id)).length,
      acTotal: acIds.length,
      ecCovered: ecIds.filter((id) => usedTags.has(id)).length,
      ecTotal: ecIds.length,
    },
  };
}

/** The timeline shows the line whole, so it has to stay short enough to read at a glance. */
const MAX_LINE = 320;
/** A scenario name longer than this is shortened. */
const MAX_NAME = 60;
/** How many scenario problems are spelled out. The rest are counted. */
const NAMED_PROBLEMS = 2;
/** A problem cut shorter than this says too little, so one problem fewer is named instead. */
const MIN_PROBLEM = 24;

/** Model-written names can hold line breaks and runs of spaces. The timeline line must stay one line. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Cuts text to at most `max` characters, the last of them "…". Never leaves half of a surrogate pair. */
function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  let kept = text.slice(0, Math.max(0, max - 1));
  const last = kept.charCodeAt(kept.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) kept = kept.slice(0, -1);
  return `${kept.trimEnd()}…`;
}

function scenarioLabel(name: string): string {
  const tidy = oneLine(name);
  return tidy ? `"${shorten(tidy, MAX_NAME)}"` : "(unnamed scenario)";
}

/**
 * Names the first scenario problems so a reader can tell what the Validator
 * objected to, within `budget` characters:
 * `3 scenario problem(s): "Name": problem; "Other": problem. (and 1 more)`.
 * When it does not fit, the last named problem is shortened; when that would
 * leave too little of it, one problem fewer is named; at worst only the count
 * is left.
 */
function describeStepIssues(issues: StepIssue[], budget: number): string {
  const head = `${issues.length} scenario problem(s)`;
  for (let named = Math.min(NAMED_PROBLEMS, issues.length); named > 0; named--) {
    const labels = issues.slice(0, named).map((issue) => scenarioLabel(issue.scenario));
    // Each problem is a sentence. Its full stop is dropped here and written once, after the last one.
    const problems = issues.slice(0, named).map((issue) => oneLine(issue.problem).replace(/[.\s]+$/, ""));
    const more = issues.length - named;
    const tail = more ? ` (and ${more} more)` : "";
    const render = (lastProblem: string) =>
      `${head}: ${labels.map((label, index) => `${label}: ${index === named - 1 ? lastProblem : problems[index]}`).join("; ")}${tail}`;

    const last = problems[named - 1];
    const full = render(`${last}.`);
    if (full.length <= budget) return full;
    const room = last.length + 1 - (full.length - budget);
    if (room >= Math.min(MIN_PROBLEM, last.length)) return render(shorten(last, room));
  }
  return head;
}

/**
 * One line for the timeline and for the reason of a fix round, e.g.
 * `uncovered: AC-2; 1 scenario problem(s): "Top-up": There is no Then step: nothing is being checked.`
 */
export function describeValidation(report: ValidationReport): string {
  if (report.ok) {
    const { scenarios, acCovered, acTotal, ecCovered, ecTotal } = report.stats;
    return `Valid Gherkin. ${scenarios} scenarios cover ${acCovered}/${acTotal} criteria and ${ecCovered}/${ecTotal} edge cases.`;
  }
  const parts: string[] = [];
  if (report.parseErrors.length) parts.push(`${report.parseErrors.length} parse error(s)`);
  if (report.uncoveredACs.length) parts.push(`uncovered: ${report.uncoveredACs.join(", ")}`);
  if (report.uncoveredECs.length) parts.push(`high-risk edge cases uncovered: ${report.uncoveredECs.join(", ")}`);
  if (report.stepIssues.length) {
    const used = parts.length ? parts.join("; ").length + 2 : 0;
    parts.push(describeStepIssues(report.stepIssues, MAX_LINE - used));
  }
  return shorten(parts.join("; "), MAX_LINE);
}
