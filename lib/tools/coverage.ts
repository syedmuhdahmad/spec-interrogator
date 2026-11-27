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

/** One line for the timeline, e.g. "2 criteria uncovered, 1 scenario problem". */
export function describeValidation(report: ValidationReport): string {
  if (report.ok) {
    const { scenarios, acCovered, acTotal, ecCovered, ecTotal } = report.stats;
    return `Valid Gherkin. ${scenarios} scenarios cover ${acCovered}/${acTotal} criteria and ${ecCovered}/${ecTotal} edge cases.`;
  }
  const parts: string[] = [];
  if (report.parseErrors.length) parts.push(`${report.parseErrors.length} parse error(s)`);
  if (report.uncoveredACs.length) parts.push(`uncovered: ${report.uncoveredACs.join(", ")}`);
  if (report.uncoveredECs.length) parts.push(`high-risk edge cases uncovered: ${report.uncoveredECs.join(", ")}`);
  if (report.stepIssues.length) parts.push(`${report.stepIssues.length} scenario problem(s)`);
  return parts.join("; ");
}
