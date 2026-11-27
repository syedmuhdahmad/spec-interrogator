import { AstBuilder, GherkinClassicTokenMatcher, Parser } from "@cucumber/gherkin";
import { IdGenerator } from "@cucumber/messages";
import type { ParseError, ScenarioInfo, ScenarioStep } from "@/lib/core/types";

export interface ParsedFeature {
  ok: boolean;
  featureName: string;
  scenarios: ScenarioInfo[];
  errors: ParseError[];
}

interface AstTag {
  name: string;
  location: { line: number };
}

interface AstStep {
  keyword: string;
  keywordType?: string;
  text: string;
}

interface AstScenario {
  keyword: string;
  name: string;
  location: { line: number };
  tags: readonly AstTag[];
  steps: readonly AstStep[];
  examples: readonly { tableHeader?: AstTableRow; tableBody?: readonly AstTableRow[] }[];
}

interface AstTableRow {
  cells: readonly { value: string }[];
}

interface AstChild {
  background?: { steps?: readonly AstStep[] };
  scenario?: AstScenario;
  rule?: { tags?: readonly AstTag[]; children: readonly AstChild[] };
}

/** Turns parser steps into ours. "And"/"But" continue whatever kind of step came before them. */
function toSteps(steps: readonly AstStep[]): ScenarioStep[] {
  let previousKind = "Unknown";
  return steps.map((step) => {
    const kind =
      step.keywordType && step.keywordType !== "Conjunction" && step.keywordType !== "Unknown"
        ? step.keywordType
        : previousKind;
    previousKind = kind;
    return { keyword: step.keyword.trim(), kind, text: step.text };
  });
}

/**
 * Parses Gherkin with the official Cucumber parser, so "valid" here means the
 * same thing it means to Cucumber, Playwright-BDD and every other runner.
 */
export function parseGherkin(text: string): ParsedFeature {
  const parser = new Parser(new AstBuilder(IdGenerator.incrementing()), new GherkinClassicTokenMatcher());

  try {
    const document = parser.parse(text);
    const feature = document.feature;
    if (!feature) {
      return { ok: false, featureName: "", scenarios: [], errors: [{ line: 1, message: "No Feature found." }] };
    }

    // Tags on the Feature line are deliberately not inherited: one line of
    // "@AC-1 @AC-2 ..." there would otherwise claim coverage for everything.
    const collected: { scenario: AstScenario; inherited: string[]; background: ScenarioStep[] }[] = [];

    // A Background applies to every scenario at its own level and below it, so
    // a scenario inside a Rule runs the feature's Background and then the Rule's.
    // Its steps are kept apart from the scenario's own: see ScenarioInfo.
    const walk = (children: readonly AstChild[], inherited: string[], outerBackground: ScenarioStep[]) => {
      const background = [
        ...outerBackground,
        ...children.flatMap((child) => (child.background ? toSteps(child.background.steps ?? []) : [])),
      ];
      for (const child of children) {
        if (child.scenario) collected.push({ scenario: child.scenario, inherited, background });
        if (child.rule) {
          walk(child.rule.children, [...inherited, ...(child.rule.tags ?? []).map((tag) => tag.name)], background);
        }
      }
    };
    walk(feature.children as readonly AstChild[], [], []);

    const scenarios = collected.map(({ scenario, inherited, background }, index): ScenarioInfo => {
      const steps = toSteps(scenario.steps);
      // An Examples block with no table at all carries nothing worth exporting.
      const examples = scenario.examples
        .map((example) => ({
          header: (example.tableHeader?.cells ?? []).map((cell) => cell.value),
          rows: (example.tableBody ?? []).map((row) => row.cells.map((cell) => cell.value)),
        }))
        .filter((table) => table.header.length > 0 || table.rows.length > 0);
      return {
        id: `S${index + 1}`,
        name: scenario.name.trim(),
        line: scenario.location.line,
        tags: [...new Set([...inherited, ...scenario.tags.map((tag) => tag.name)])],
        tagLine: scenario.tags.length ? Math.max(...scenario.tags.map((tag) => tag.location.line)) : undefined,
        isOutline: /outline|template/i.test(scenario.keyword),
        exampleRows: scenario.examples.reduce((sum, example) => sum + (example.tableBody?.length ?? 0), 0),
        ...(examples.length ? { examples } : {}),
        // Each scenario gets its own copy, so changing one cannot change another.
        ...(background.length ? { background: background.map((step) => ({ ...step })) } : {}),
        steps,
      };
    });

    return { ok: true, featureName: feature.name.trim(), scenarios, errors: [] };
  } catch (error) {
    return { ok: false, featureName: "", scenarios: [], errors: toParseErrors(error) };
  }
}

function toParseErrors(error: unknown): ParseError[] {
  const composite = error as { errors?: { location?: { line?: number }; message?: string }[]; message?: string };
  const list = composite.errors?.length ? composite.errors : [composite];
  return list.slice(0, 8).map((item) => ({
    line: (item as { location?: { line?: number } }).location?.line ?? 1,
    message: tidy(item.message ?? "Could not parse the feature file."),
  }));
}

/** Shortens the parser's token list into something a person (or the Test Designer) can act on. */
function tidy(message: string): string {
  const got = /got '([^']*)'/.exec(message);
  const stripped = message.replace(/^\(\d+:\d+\):\s*/, "");
  if (got) return `Unexpected line: "${got[1].slice(0, 80)}". It is not valid Gherkin at this position.`;
  return stripped.slice(0, 200);
}

/**
 * Adds a priority tag (@P1..@P3) to each scenario's tag line. Works from the
 * bottom up so earlier line numbers stay correct, then re-parses the result
 * and falls back to the original text if anything went wrong.
 */
export function applyPriorityTags(
  text: string,
  scenarios: ScenarioInfo[],
  priorityById: Map<string, string>,
): string {
  const lines = text.split("\n");
  for (const scenario of [...scenarios].sort((a, b) => b.line - a.line)) {
    const priority = priorityById.get(scenario.id);
    if (!priority || scenario.tags.some((tag) => /^@P[1-3]$/i.test(tag))) continue;

    if (scenario.tagLine) {
      const index = scenario.tagLine - 1;
      // A tag line may end in a comment; the new tag has to go before it.
      const comment = /\s+#.*$/.exec(lines[index]);
      const tags = comment ? lines[index].slice(0, comment.index) : lines[index].trimEnd();
      lines[index] = `${tags} @${priority}${comment ? comment[0] : ""}`;
    } else {
      const index = scenario.line - 1;
      const indent = /^\s*/.exec(lines[index] ?? "")?.[0] ?? "  ";
      lines.splice(index, 0, `${indent}@${priority}`);
    }
  }
  const tagged = lines.join("\n");
  return parseGherkin(tagged).ok ? tagged : text;
}
