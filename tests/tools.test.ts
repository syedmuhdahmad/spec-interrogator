import { describe, expect, it } from "vitest";
import type { Criterion, EdgeCase } from "@/lib/core/types";
import { checkCoverage } from "@/lib/tools/coverage";
import { buildExports, buildJiraCsv, buildPlaywrightSpec, buildTestPlan, commentSafe, csvCell, type ReportInput } from "@/lib/tools/exporters";
import { appendScenarios } from "@/lib/agents/designer";
import { applyPriorityTags, parseGherkin } from "@/lib/tools/gherkin";
import { parseIssueUrl, sanitizeSearchTerms } from "@/lib/tools/github";

const criteria: Criterion[] = [
  { id: "AC-1", text: "User can top up", sourceQuote: "", quoteVerified: true },
  { id: "AC-2", text: "Failed payments show an error", sourceQuote: "", quoteVerified: true },
];
const edgeCases: EdgeCase[] = [
  { id: "EC-1", title: "Zero amount", category: "boundary", relatedAC: "AC-1", severity: "high", expected: "Rejected" },
  { id: "EC-2", title: "Slow network", category: "error", relatedAC: "AC-2", severity: "low", expected: "Retry" },
];

const GOOD = `Feature: Wallet top-up

  @AC-1
  Scenario: Successful top-up
    Given a customer with a valid card
    When the customer tops up 500
    Then the balance increases by 500

  @AC-2 @EC-1
  Scenario Outline: Rejected amounts
    Given a customer with a valid card
    When the customer tops up <amount>
    Then the message "<message>" is shown
    And the balance is unchanged

    Examples:
      | amount | message        |
      | 0      | Enter an amount |
`;

const OUTLINE = `Feature: Wallet top-up

  @AC-1
  Scenario: Successful top-up
    Given a customer with a valid card
    When the customer tops up 500
    Then the balance increases by 500

  @AC-2 @EC-1 @Needs-Clarification
  Scenario Outline: Declined card shows an error
    Given the card is declined because of <reason>
    When the customer confirms the top-up
    Then the message names <detail>

    Examples:
      | reason             | detail          |
      | insufficient funds | the balance     |
      | an expired card    | the expiry date |
`;

describe("parseGherkin", () => {
  it("reads the Examples table of a Scenario Outline, header and rows", () => {
    const parsed = parseGherkin(OUTLINE);
    expect(parsed.ok).toBe(true);
    expect(parsed.scenarios[0].examples).toBeUndefined();
    expect(parsed.scenarios[1].exampleRows).toBe(2);
    expect(parsed.scenarios[1].examples).toEqual([
      {
        header: ["reason", "detail"],
        rows: [
          ["insufficient funds", "the balance"],
          ["an expired card", "the expiry date"],
        ],
      },
    ]);
  });

  it("keeps each Examples block of a Scenario Outline as its own table", () => {
    const twoBlocks = [
      "Feature: X",
      "  Scenario Outline: Y",
      "    When the customer pays <amount>",
      "    Then the result is <result>",
      "    Examples: Accepted",
      "      | amount | result   |",
      "      | 10     | accepted |",
      "    Examples: Refused",
      "      | amount | result  |",
      "      | 0      | refused |",
      "      | -5     | refused |",
    ].join("\n");
    const scenario = parseGherkin(twoBlocks).scenarios[0];
    expect(scenario.exampleRows).toBe(3);
    expect(scenario.examples).toEqual([
      { header: ["amount", "result"], rows: [["10", "accepted"]] },
      { header: ["amount", "result"], rows: [["0", "refused"], ["-5", "refused"]] },
    ]);
  });

  it("reads scenarios, tags and step kinds", () => {
    const parsed = parseGherkin(GOOD);
    expect(parsed.ok).toBe(true);
    expect(parsed.featureName).toBe("Wallet top-up");
    expect(parsed.scenarios.map((scenario) => scenario.id)).toEqual(["S1", "S2"]);
    expect(parsed.scenarios[1].isOutline).toBe(true);
    expect(parsed.scenarios[1].exampleRows).toBe(1);
    // "And" continues the Then that came before it.
    expect(parsed.scenarios[1].steps.at(-1)?.kind).toBe("Outcome");
  });

  it("reports the line of a syntax error", () => {
    const parsed = parseGherkin("Feature: X\n  Scenario: Y\n    Given a\n    This is not a step\n");
    expect(parsed.ok).toBe(false);
    expect(parsed.errors[0].line).toBe(4);
    expect(parsed.errors[0].message).toContain("This is not a step");
  });

  it("rejects text that is not a feature at all", () => {
    expect(parseGherkin("Sure! Here is your test plan.").ok).toBe(false);
    expect(parseGherkin("").ok).toBe(false);
  });

  it("inherits tags from a Rule", () => {
    const parsed = parseGherkin("Feature: X\n  @AC-1\n  Rule: R\n    Scenario: Y\n      When a\n      Then b\n");
    expect(parsed.scenarios[0].tags).toContain("@AC-1");
  });

  it("does not let tags on the Feature line claim coverage for every scenario", () => {
    const blanket = "@AC-1 @AC-2 @EC-1\nFeature: X\n  Scenario: Y\n    When a\n    Then b\n";
    const parsed = parseGherkin(blanket);
    expect(parsed.scenarios[0].tags).toEqual([]);
    expect(checkCoverage(parsed, criteria, edgeCases).uncoveredACs).toEqual(["AC-1", "AC-2"]);
  });
});

describe("checkCoverage", () => {
  it("passes a complete suite", () => {
    const report = checkCoverage(parseGherkin(GOOD), criteria, edgeCases);
    expect(report.ok).toBe(true);
    expect(report.stats).toMatchObject({ scenarios: 2, acCovered: 2, acTotal: 2, ecCovered: 1, ecTotal: 2 });
  });

  it("flags an uncovered criterion and an uncovered high-severity edge case", () => {
    const partial = "Feature: X\n  @AC-1\n  Scenario: Only one\n    When a\n    Then b\n";
    const report = checkCoverage(parseGherkin(partial), criteria, edgeCases);
    expect(report.ok).toBe(false);
    expect(report.uncoveredACs).toEqual(["AC-2"]);
    expect(report.uncoveredECs).toEqual(["EC-1"]);
  });

  it("does not require low-severity edge cases", () => {
    const report = checkCoverage(parseGherkin(GOOD), criteria, edgeCases);
    expect(report.uncoveredECs).not.toContain("EC-2");
  });

  it("flags a scenario with nothing to check", () => {
    const noThen = "Feature: X\n  @AC-1 @AC-2 @EC-1\n  Scenario: No assertion\n    Given a\n    When b\n";
    const report = checkCoverage(parseGherkin(noThen), criteria, edgeCases);
    expect(report.ok).toBe(false);
    expect(report.stepIssues[0].problem).toMatch(/no Then step/i);
  });

  it("flags duplicates, untagged scenarios, empty outlines and invented ids", () => {
    const messy = [
      "Feature: X",
      "  @AC-1 @AC-2 @EC-1 @AC-9",
      "  Scenario: Same name",
      "    When a",
      "    Then b",
      "  Scenario: Same name",
      "    When a",
      "    Then b",
      "  @AC-1",
      "  Scenario Outline: No rows",
      "    When <x>",
      "    Then b",
    ].join("\n");
    const problems = checkCoverage(parseGherkin(messy), criteria, edgeCases).stepIssues.map((issue) => issue.problem).join(" | ");
    expect(problems).toMatch(/Duplicate scenario name/);
    expect(problems).toMatch(/No @AC-n tag/);
    expect(problems).toMatch(/no Examples rows/);
    expect(problems).toMatch(/@AC-9 does not match/);
  });

  it("treats a file that does not parse as covering nothing", () => {
    const report = checkCoverage(parseGherkin("nonsense"), criteria, edgeCases);
    expect(report.ok).toBe(false);
    expect(report.parseErrors.length).toBeGreaterThan(0);
    expect(report.uncoveredACs).toEqual(["AC-1", "AC-2"]);
  });
});

describe("applyPriorityTags", () => {
  it("adds priorities and keeps the file valid", () => {
    const parsed = parseGherkin(GOOD);
    const tagged = applyPriorityTags(GOOD, parsed.scenarios, new Map([["S1", "P1"], ["S2", "P3"]]));
    const reparsed = parseGherkin(tagged);
    expect(reparsed.ok).toBe(true);
    expect(reparsed.scenarios[0].tags).toEqual(["@AC-1", "@P1"]);
    expect(reparsed.scenarios[1].tags).toEqual(["@AC-2", "@EC-1", "@P3"]);
  });

  it("puts the priority before a trailing comment on the tag line", () => {
    const commented = "Feature: X\n  @AC-1 #covers the happy path\n  Scenario: Y\n    When a\n    Then b\n";
    const tagged = applyPriorityTags(commented, parseGherkin(commented).scenarios, new Map([["S1", "P1"]]));
    expect(tagged).toContain("@AC-1 @P1 #covers the happy path");
    expect(parseGherkin(tagged).scenarios[0].tags).toEqual(["@AC-1", "@P1"]);
  });

  it("adds a tag line when a scenario has none", () => {
    const bare = "Feature: X\n  Scenario: Y\n    When a\n    Then b\n";
    const tagged = applyPriorityTags(bare, parseGherkin(bare).scenarios, new Map([["S1", "P2"]]));
    expect(parseGherkin(tagged).scenarios[0].tags).toEqual(["@P2"]);
  });
});

describe("appendScenarios", () => {
  const base = "Feature: X\n\n  @AC-1\n  Scenario: First\n    When a\n    Then b\n";

  it("drops a repeated Feature header and indents the new scenarios under the feature", () => {
    const merged = appendScenarios(base, "Feature: X\n  Some description\n\n@AC-2\nScenario: Second\n  When c\n  Then d");
    expect(merged.match(/Feature:/g)).toHaveLength(1);
    expect(merged).toContain("\n\n  @AC-2\n  Scenario: Second\n    When c\n    Then d\n");
    expect(parseGherkin(merged).scenarios.map((scenario) => scenario.name)).toEqual(["First", "Second"]);
  });

  it("pulls in over-indented scenarios", () => {
    const merged = appendScenarios(base, "      @AC-2\n      Scenario: Second\n        When c\n        Then d");
    expect(merged).toContain("\n  @AC-2\n  Scenario: Second\n    When c\n");
    expect(parseGherkin(merged).ok).toBe(true);
  });
});

describe("GitHub input handling", () => {
  it("accepts a normal issue link", () => {
    expect(parseIssueUrl("https://github.com/microsoft/playwright/issues/30976")).toEqual({
      owner: "microsoft",
      repo: "playwright",
      number: 30976,
    });
    expect(parseIssueUrl(" https://github.com/a/b.c_d/issues/1/?x=1#y ").repo).toBe("b.c_d");
  });

  it.each([
    "http://github.com/a/b/issues/1",
    "https://github.com.evil.example/a/b/issues/1",
    "https://evil.example/github.com/a/b/issues/1",
    "https://github.com/a/b/pull/1",
    "https://github.com/a/../issues/1",
    "https://github.com/a/b/issues/1/../../../../user",
    "https://169.254.169.254/latest/meta-data",
    "https://github.com/a/b/issues/abc",
    "javascript:alert(1)",
    "",
  ])("rejects %s", (url) => {
    expect(() => parseIssueUrl(url)).toThrow(/not a GitHub issue link/);
  });

  it("strips search qualifiers so a query cannot leave the repository", () => {
    expect(sanitizeSearchTerms("export csv repo:other/secret user:someone")).toBe("export csv");
    expect(sanitizeSearchTerms('"login" OR is:open; timeout!!')).toBe("login OR timeout");
    expect(sanitizeSearchTerms("one two three four five six seven eight").split(" ")).toHaveLength(6);
  });
});

describe("exporters", () => {
  const parsed = parseGherkin(GOOD);
  const input: ReportInput = {
    story: { source: "text", title: "Wallet top-up", text: "story", truncated: false },
    plan: { domain: "Payments", summary: "Top up a wallet.", focusAreas: ["Money"], riskLevel: "high", notes: "" },
    criteria,
    ambiguities: [
      { term: "=fast", quote: "should be fast", whyItMatters: "No SLA.", question: "How fast, in seconds?", severity: "high", quoteVerified: true },
    ],
    edgeCases,
    feature: GOOD,
    featureName: parsed.featureName,
    scenarios: parsed.scenarios,
    validation: checkCoverage(parsed, criteria, edgeCases),
    ranking: [
      { id: "S1", scenario: 'Successful "top-up"', priority: "P1", reason: "Core flow, a | pipe", tags: ["@AC-1"] },
      { id: "S2", scenario: "Rejected amounts", priority: "P3", reason: "Rare", tags: ["@AC-2", "@EC-1"] },
    ],
  };

  it("neutralises spreadsheet formulas in CSV cells", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvCell("+1")).toBe("\"'+1\"");
    expect(csvCell("-1")).toBe("\"'-1\"");
    expect(csvCell("@cmd")).toBe("\"'@cmd\"");
    expect(csvCell("plain, with comma")).toBe('"plain, with comma"');
  });

  it("builds a Jira CSV with one row per question and per scenario", () => {
    const csv = buildJiraCsv(input);
    const header = csv.split("\r\n")[0];
    expect(header).toBe('"Summary","Issue Type","Priority","Labels","Description"');
    expect(csv).toContain('"Clarify: =fast"');
    expect(csv).toContain('"Test: Successful ""top-up""","Test","High","test-case AC-1"');
  });

  it("builds Playwright stubs that are safe against odd scenario names", () => {
    const spec = buildPlaywrightSpec({
      ...input,
      scenarios: [{ ...parsed.scenarios[0], name: "It's a `tricky` \"name\" ${x}" }],
    });
    expect(spec).toContain("test.fixme(\"It's a `tricky` \\\"name\\\" ${x}\"");
    expect(spec).toContain('tag: ["@AC-1","@P1"]');
    expect(spec).toContain("// When the customer tops up 500");
  });

  it("keeps step text inside its comment whatever line-break characters it contains", () => {
    const hostile = "x\u2028}); require('child_process').exec('id'); test('y', async () => {\r//\u2029z\u0085";
    expect(commentSafe(hostile)).not.toMatch(/[\r\n\u2028\u2029\u0085]/);
    const spec = buildPlaywrightSpec({
      ...input,
      scenarios: [{ ...parsed.scenarios[0], steps: [{ keyword: "When", kind: "Action", text: hostile }] }],
    });
    // Every line of generated code that mentions the payload must still be a comment.
    const offending = spec.split(/\r\n|[\n\r\u2028\u2029]/).filter((line) => line.includes("child_process") && !line.trimStart().startsWith("//"));
    expect(offending).toEqual([]);
  });

  describe("Scenario Outline examples, question summaries and labels", () => {
    const outline = parseGherkin(OUTLINE);
    const outlineInput: ReportInput = {
      ...input,
      ambiguities: [
        { term: "Missing: supported currencies", quote: "", whyItMatters: "Amounts differ.", question: "Which currencies?", severity: "medium", quoteVerified: false },
        { term: "  missing :refund window", quote: "", whyItMatters: "No rule.", question: "How long?", severity: "low", quoteVerified: false },
        { term: "promptly", quote: "shown promptly", whyItMatters: "No limit.", question: "How many seconds?", severity: "high", quoteVerified: true },
        { term: "Missing:", quote: "", whyItMatters: "Empty.", question: "What is missing?", severity: "low", quoteVerified: false },
      ],
      feature: OUTLINE,
      featureName: outline.featureName,
      scenarios: outline.scenarios,
      validation: checkCoverage(outline, criteria, edgeCases),
      ranking: [
        { id: "S1", scenario: "Successful top-up", priority: "P1", reason: "Core flow", tags: outline.scenarios[0].tags },
        { id: "S2", scenario: "Declined card shows an error", priority: "P2", reason: "Common failure", tags: outline.scenarios[1].tags },
      ],
    };

    /** Swaps the Examples table of the outline scenario for a made-up one. */
    const withTable = (header: string[], rows: string[][]): ReportInput => ({
      ...outlineInput,
      scenarios: [outline.scenarios[0], { ...outline.scenarios[1], examples: [{ header, rows }] }],
    });

    it("puts the Examples table after the steps in the Jira description", () => {
      const csv = buildJiraCsv(outlineInput);
      expect(csv).toContain(
        [
          "Priority reason: Common failure",
          "",
          "Given the card is declined because of <reason>",
          "When the customer confirms the top-up",
          "Then the message names <detail>",
          "",
          "Examples:",
          "| reason | detail |",
          "| insufficient funds | the balance |",
          '| an expired card | the expiry date |"',
        ].join("\n"),
      );
    });

    it("writes the Examples table as comments in the Playwright stub", () => {
      const spec = buildPlaywrightSpec(outlineInput);
      expect(spec).toContain(
        [
          "    // Then the message names <detail>",
          "    // Examples:",
          "    //   | reason | detail |",
          "    //   | insufficient funds | the balance |",
          "    //   | an expired card | the expiry date |",
          "    // Scenario Outline: run once per Examples row (2).",
          "  });",
        ].join("\n"),
      );
    });

    it("keeps an Examples cell inside its comment whatever line-break characters it contains", () => {
      const hostile = "x\u2028}); require('child_process').exec('id'); test('y', async () => {\r//\u2029z\u0085";
      const spec = buildPlaywrightSpec(withTable(["reason", `head\n${hostile}`], [["first\nsecond", hostile]]));
      const lines = spec.split(/\r\n|[\n\r\u2028\u2029\u0085]/);
      expect(lines.filter((line) => line.includes("child_process") && !line.trimStart().startsWith("//"))).toEqual([]);
      // The payload sits in the header row and in the one data row, and each is still a single line.
      expect(lines.filter((line) => line.includes("child_process"))).toHaveLength(2);
      expect(spec).toContain("    //   | first\\nsecond | x }); require(");
    });

    it("keeps a line break in an Examples cell from splitting a Jira table row", () => {
      const csv = buildJiraCsv(withTable(["reason", "detail"], [["first\nsecond", "third\r\nfourth\u2028fifth"]]));
      expect(csv).toContain("\n| reason | detail |\n| first\\nsecond | third\\nfourth fifth |\"");
    });

    it("escapes a pipe and a backslash inside an Examples cell", () => {
      const piped = parseGherkin(
        ["Feature: X", "  Scenario Outline: Y", "    When <input>", "    Then <output>", "    Examples:", "      | input    | output |", "      | a \\| b | c \\\\ d |"].join("\n"),
      );
      expect(piped.scenarios[0].examples?.[0].rows).toEqual([["a | b", "c \\ d"]]);
      const pipedInput: ReportInput = {
        ...outlineInput,
        scenarios: piped.scenarios,
        ranking: [{ id: "S1", scenario: "Y", priority: "P2", reason: "Made up", tags: [] }],
      };
      expect(buildJiraCsv(pipedInput)).toContain("\n| input | output |\n| a \\| b | c \\\\ d |\"");
      expect(buildPlaywrightSpec(pipedInput)).toContain("    //   | a \\| b | c \\\\ d |\n");
    });

    it("rewrites a question about something missing and leaves other terms alone", () => {
      const summaries = buildJiraCsv(outlineInput)
        .split("\r\n")
        .slice(1, 5)
        .map((row) => row.split('","')[0].slice(1));
      expect(summaries).toEqual([
        "Clarify (missing): supported currencies",
        "Clarify (missing): refund window",
        "Clarify: promptly",
        "Clarify: Missing:",
      ]);
    });

    it("labels a test case whose scenario is tagged @needs-clarification, and only that one", () => {
      const csv = buildJiraCsv(outlineInput);
      expect(csv).toContain('"Test: Declined card shows an error","Test","Medium","test-case AC-2 EC-1 needs-clarification"');
      expect(csv).toContain('"Test: Successful top-up","Test","High","test-case AC-1","');
    });

    it("keeps the @needs-clarification tag on a Playwright stub, and only on a scenario that has it", () => {
      const spec = buildPlaywrightSpec(outlineInput);
      // The feature file writes it as @Needs-Clarification: the stub gets the one spelling, before the priority.
      expect(spec).toContain('test.fixme("Declined card shows an error", { tag: ["@AC-2","@EC-1","@needs-clarification","@P2"] }');
      expect(spec).toContain('test.fixme("Successful top-up", { tag: ["@AC-1","@P1"] }');
      expect(spec.match(/@needs-clarification/gi)).toHaveLength(1);
    });

    it("writes @needs-clarification once on a stub whose scenario carries the tag twice", () => {
      const twice = { ...outline.scenarios[1], tags: ["@needs-clarification", "@AC-2", "@NEEDS-CLARIFICATION"] };
      const spec = buildPlaywrightSpec({ ...outlineInput, scenarios: [outline.scenarios[0], twice] });
      expect(spec).toContain('{ tag: ["@AC-2","@needs-clarification","@P2"] }');
      expect(spec.match(/@needs-clarification/gi)).toHaveLength(1);
    });

    it("exports a scenario with no Examples exactly as before", () => {
      const plain: ReportInput = { ...outlineInput, ambiguities: [], scenarios: [outline.scenarios[0]], ranking: [outlineInput.ranking[0]] };
      expect(buildJiraCsv(plain)).toBe(
        [
          '"Summary","Issue Type","Priority","Labels","Description"',
          '"Test: Successful top-up","Test","High","test-case AC-1","Priority reason: Core flow\n\nGiven a customer with a valid card\nWhen the customer tops up 500\nThen the balance increases by 500"',
          "",
        ].join("\r\n"),
      );
      expect(buildPlaywrightSpec(plain)).toBe(
        [
          "import { test } from '@playwright/test';",
          "",
          "// Generated by Spec Interrogator from the .feature file.",
          "// Each test is marked fixme until its steps are implemented.",
          "",
          'test.describe("Wallet top-up", () => {',
          '  test.fixme("Successful top-up", { tag: ["@AC-1","@P1"] }, async ({ page }) => {',
          "    void page;",
          "    // Given a customer with a valid card",
          "    // When the customer tops up 500",
          "    // Then the balance increases by 500",
          "  });",
          "});",
          "",
        ].join("\n"),
      );
    });

    it("still exports an outline whose ScenarioInfo carries no Examples table", () => {
      const { examples, ...bare } = outline.scenarios[1];
      expect(examples).toHaveLength(1);
      const stripped: ReportInput = { ...outlineInput, scenarios: [outline.scenarios[0], bare] };
      expect(buildJiraCsv(stripped)).not.toContain("Examples:");
      const spec = buildPlaywrightSpec(stripped);
      expect(spec).not.toContain("// Examples:");
      expect(spec).toContain("// Scenario Outline: run once per Examples row (2).");
    });
  });

  it("produces four files with safe names", () => {
    const files = buildExports(input);
    expect(files.map((file) => file.name)).toEqual([
      "wallet-top-up-test-plan.md",
      "wallet-top-up.feature",
      "wallet-top-up.spec.ts",
      "wallet-top-up-jira.csv",
    ]);
    expect(files[0].content).toContain("## Questions for the client");
    expect(files[0].content).toContain("Core flow, a \\| pipe");
  });

  it("never ends a file name stem in a hyphen when the title is cut at a separator", () => {
    const title = "Wallet top-up for returning customers with card limits per day";
    // The fixture only proves something if the 48th character of the uncut stem is a separator.
    expect(title.toLowerCase().replace(/[^a-z0-9]+/g, "-")[47]).toBe("-");
    const names = buildExports({ ...input, story: { ...input.story, title } }).map((file) => file.name);
    expect(names).toEqual([
      "wallet-top-up-for-returning-customers-with-card-test-plan.md",
      "wallet-top-up-for-returning-customers-with-card.feature",
      "wallet-top-up-for-returning-customers-with-card.spec.ts",
      "wallet-top-up-for-returning-customers-with-card-jira.csv",
    ]);
    for (const name of names) {
      expect(name).not.toContain("--");
      expect(name).not.toContain("-.");
    }
  });

  it("falls back to the name feature when the title is only punctuation", () => {
    const names = buildExports({ ...input, story: { ...input.story, title: "?! ... --- (#)" } }).map((file) => file.name);
    expect(names).toEqual(["feature-test-plan.md", "feature.feature", "feature.spec.ts", "feature-jira.csv"]);
  });

  describe("edge cases without a scenario in the test plan", () => {
    const fourEdgeCases: EdgeCase[] = [
      ...edgeCases,
      { id: "EC-3", title: "Top-up above the daily limit", category: "boundary", relatedAC: "AC-1", severity: "medium", expected: "Rejected" },
      { id: "EC-4", title: "Card expires during the top-up", category: "error", relatedAC: "AC-2", severity: "medium", expected: "Error shown" },
    ];
    const [first, second] = parsed.scenarios;
    const planFor = (cases: EdgeCase[], scenarios: ReportInput["scenarios"]): string =>
      buildTestPlan({ ...input, edgeCases: cases, scenarios, validation: checkCoverage({ ...parsed, scenarios }, criteria, cases) });
    const LINE = /^- Edge cases without a scenario:.*$/m;

    it("names each edge case no scenario is tagged with, in order, with its severity", () => {
      // EC-1 is tagged in the feature file; EC-3 is tagged here in lower case, which must still count.
      const plan = planFor(fourEdgeCases, [{ ...first, tags: [...first.tags, "@ec-3"] }, second]);
      expect(plan).toContain(
        [
          "- Edge cases covered: 2 of 4",
          "- Edge cases without a scenario: EC-2 (low), EC-4 (medium). Only high-severity edge cases must have one.",
          "- Automated checks: passed",
        ].join("\n"),
      );
      expect(plan).not.toContain("## Known gaps");
    });

    it("names an uncovered high-severity edge case too, and still lists it under Known gaps", () => {
      const plan = planFor(edgeCases, [first]);
      expect(plan.match(LINE)?.[0]).toBe("- Edge cases without a scenario: EC-1 (high), EC-2 (low). Only high-severity edge cases must have one.");
      expect(plan).toContain("- High-severity edge case EC-1 has no scenario.");
    });

    it("leaves the line out when every edge case has a scenario or there are no edge cases", () => {
      const allCovered = planFor(edgeCases, [first, { ...second, tags: [...second.tags, "@EC-2"] }]);
      expect(allCovered).toContain("- Edge cases covered: 2 of 2\n- Automated checks: passed");
      expect(allCovered).not.toMatch(LINE);

      const none = planFor([], [first, { ...second, tags: ["@AC-2"] }]);
      expect(none).toContain("- Edge cases covered: 0 of 0\n- Automated checks: passed");
      expect(none).not.toMatch(LINE);
    });
  });
});
