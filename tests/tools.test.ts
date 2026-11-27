import { describe, expect, it } from "vitest";
import type { Criterion, EdgeCase, StepIssue, ValidationReport } from "@/lib/core/types";
import { checkCoverage, describeValidation } from "@/lib/tools/coverage";
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

/** The scenarios of BACKGROUND, without its Background block. */
const NO_BACKGROUND = `Feature: Top up wallet with a debit card

  @AC-1
  Scenario: Successful top-up
    Given the customer enters a top-up amount of 20.00
    When the customer confirms the top-up
    Then the wallet balance is shown as 70.00

  @AC-2 @EC-1
  Scenario: Declined card
    When the card is declined
    Then the wallet balance is shown as 50.00
`;

const BACKGROUND = NO_BACKGROUND.replace(
  "\n  @AC-1\n",
  "\n  Background:\n    Given a signed-in customer with a wallet balance of 50.00\n    And a saved debit card\n\n  @AC-1\n",
);

const RULE_BACKGROUND = `Feature: Top up wallet with a debit card

  Background:
    Given a signed-in customer with a wallet balance of 50.00

  @AC-1
  Scenario: Successful top-up
    When the customer tops up 20.00
    Then the wallet balance is shown as 70.00

  Rule: A daily limit applies

    Background:
      Given the daily limit is 500.00
      And the customer has already topped up 450.00 today

    @AC-2 @EC-1
    Scenario: Top-up above the daily limit
      When the customer tops up 60.00
      Then the top-up is refused

  Rule: A declined card changes nothing

    @AC-2
    Scenario: Declined card
      When the card is declined
      Then the wallet balance is shown as 50.00
`;

const SIGNED_IN = { keyword: "Given", kind: "Context", text: "a signed-in customer with a wallet balance of 50.00" };

describe("parseGherkin", () => {
  it("gives the feature's Background steps to every scenario and keeps them out of the scenario's own steps", () => {
    expect(BACKGROUND).toContain("Background:");
    const parsed = parseGherkin(BACKGROUND);
    expect(parsed.ok).toBe(true);
    expect(parsed.scenarios.map((scenario) => scenario.name)).toEqual(["Successful top-up", "Declined card"]);
    for (const scenario of parsed.scenarios) {
      // "And" continues the Given that came before it.
      expect(scenario.background).toEqual([SIGNED_IN, { keyword: "And", kind: "Context", text: "a saved debit card" }]);
    }
    // The scenarios themselves are exactly what they are without the Background.
    const plain = parseGherkin(NO_BACKGROUND);
    expect(parsed.scenarios.map((scenario) => scenario.steps)).toEqual(plain.scenarios.map((scenario) => scenario.steps));
    expect(parsed.scenarios.map((scenario) => scenario.tags)).toEqual(plain.scenarios.map((scenario) => scenario.tags));
  });

  it("puts a Rule's Background after the feature's, and only on that Rule's scenarios", () => {
    const parsed = parseGherkin(RULE_BACKGROUND);
    expect(parsed.ok).toBe(true);
    const [outside, limited, declined] = parsed.scenarios;
    expect(outside.background).toEqual([SIGNED_IN]);
    expect(limited.name).toBe("Top-up above the daily limit");
    expect(limited.background).toEqual([
      SIGNED_IN,
      { keyword: "Given", kind: "Context", text: "the daily limit is 500.00" },
      { keyword: "And", kind: "Context", text: "the customer has already topped up 450.00 today" },
    ]);
    // The next Rule has no Background of its own and must not pick up its neighbour's.
    expect(declined.name).toBe("Declined card");
    expect(declined.background).toEqual([SIGNED_IN]);
    expect(limited.steps.map((step) => step.text)).toEqual(["the customer tops up 60.00", "the top-up is refused"]);
  });

  it("gives a Background written only inside a Rule to that Rule's scenarios alone", () => {
    const onlyInRule = RULE_BACKGROUND.replace("  Background:\n    Given a signed-in customer with a wallet balance of 50.00\n\n", "");
    const [outside, limited, declined] = parseGherkin(onlyInRule).scenarios;
    expect(outside).not.toHaveProperty("background");
    expect(limited.background?.map((step) => step.text)).toEqual(["the daily limit is 500.00", "the customer has already topped up 450.00 today"]);
    expect(declined).not.toHaveProperty("background");
  });

  it("leaves the background field out when there is no Background, or one with no steps", () => {
    for (const scenario of parseGherkin(NO_BACKGROUND).scenarios) expect(scenario).not.toHaveProperty("background");
    for (const scenario of parseGherkin(GOOD).scenarios) expect(scenario).not.toHaveProperty("background");
    const empty = parseGherkin(NO_BACKGROUND.replace("\n  @AC-1\n", "\n  Background:\n\n  @AC-1\n"));
    expect(empty.ok).toBe(true);
    expect(empty.scenarios).toHaveLength(2);
    for (const scenario of empty.scenarios) expect(scenario).not.toHaveProperty("background");
  });

  it("gives each scenario its own copy of the Background steps", () => {
    const [first, second] = parseGherkin(BACKGROUND).scenarios;
    if (first.background) first.background[0].text = "changed";
    expect(second.background?.[0]).toEqual(SIGNED_IN);
  });

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

  it("counts the same steps with or without a Background", () => {
    const withBackground = checkCoverage(parseGherkin(BACKGROUND), criteria, edgeCases);
    const without = checkCoverage(parseGherkin(NO_BACKGROUND), criteria, edgeCases);
    expect(without.stats.steps).toBe(5);
    expect(withBackground.stats.steps).toBe(5);
    expect(withBackground).toEqual(without);
    expect(withBackground.ok).toBe(true);
  });

  it("does not let a Background step stand in for a scenario's own When or Then", () => {
    const leaning = [
      "Feature: Top up wallet with a debit card",
      "  Background:",
      "    Given a signed-in customer with a wallet balance of 50.00",
      "    When the customer opens the top-up page",
      "    Then the top-up form is shown",
      "  @AC-1 @AC-2 @EC-1",
      "  Scenario: Top-up form",
      "    Given the customer has a saved debit card",
    ].join("\n");
    const parsed = parseGherkin(leaning);
    expect(parsed.scenarios[0].background).toHaveLength(3);
    const report = checkCoverage(parsed, criteria, edgeCases);
    expect(report.stats.steps).toBe(1);
    expect(report.stepIssues.map((issue) => issue.problem)).toEqual([
      "There is no When step: nothing is being done.",
      "There is no Then step: nothing is being checked.",
    ]);
  });
});

describe("describeValidation", () => {
  const failing = (stepIssues: StepIssue[], rest: Partial<ValidationReport> = {}): ValidationReport => ({
    ok: false,
    parseErrors: [],
    uncoveredACs: [],
    uncoveredECs: [],
    unknownTags: [],
    stepIssues,
    stats: { scenarios: stepIssues.length, steps: 0, acCovered: 0, acTotal: 2, ecCovered: 0, ecTotal: 2 },
    ...rest,
  });
  const NO_THEN = "There is no Then step: nothing is being checked.";
  const NO_TAG = "No @AC-n tag: the scenario is not linked to an acceptance criterion.";

  it("keeps the text for a suite that passed", () => {
    expect(describeValidation(checkCoverage(parseGherkin(GOOD), criteria, edgeCases))).toBe(
      "Valid Gherkin. 2 scenarios cover 2/2 criteria and 1/2 edge cases.",
    );
  });

  it("names the scenario and the problem when there is one scenario problem", () => {
    const noThen = "Feature: Wallet top-up\n  @AC-1 @AC-2 @EC-1\n  Scenario: Top-up without a check\n    Given a wallet\n    When the customer tops up 20.00\n";
    expect(describeValidation(checkCoverage(parseGherkin(noThen), criteria, edgeCases))).toBe(
      '1 scenario problem(s): "Top-up without a check": There is no Then step: nothing is being checked.',
    );
  });

  it("names the first two of three scenario problems and counts the third", () => {
    const three = [
      "Feature: Wallet top-up",
      "  Scenario: Double-tap on confirm",
      "    When the customer taps confirm twice",
      "    Then the wallet is topped up once",
      "  @AC-1 @AC-2 @EC-1",
      "  Scenario: Top-up",
      "    When the customer tops up 20.00",
      "  @AC-1",
      "  Scenario Outline: Rejected amounts",
      "    When the customer tops up <amount>",
      "    Then the top-up is refused",
    ].join("\n");
    const report = checkCoverage(parseGherkin(three), criteria, edgeCases);
    expect(report.stepIssues).toHaveLength(3);
    const line = describeValidation(report);
    expect(line).toBe(
      '3 scenario problem(s): "Double-tap on confirm": No @AC-n tag: the scenario is not linked to an acceptance criterion; "Top-up": There is no Then step: nothing is being checked. (and 1 more)',
    );
    expect(line).not.toContain(".;");
  });

  it("names both problems and ends in one full stop when there are exactly two", () => {
    const line = describeValidation(failing([
      { scenario: "Double-tap on confirm", line: 3, problem: NO_TAG },
      { scenario: "Top-up", line: 8, problem: NO_THEN },
    ]));
    expect(line).toBe(
      '2 scenario problem(s): "Double-tap on confirm": No @AC-n tag: the scenario is not linked to an acceptance criterion; "Top-up": There is no Then step: nothing is being checked.',
    );
  });

  it("keeps the parts about parse errors and coverage as they were, before the scenario problems", () => {
    const partial = "Feature: Wallet top-up\n  @AC-1\n  Scenario: Only one\n    When the customer tops up 20.00\n    Then the balance is 70.00\n";
    expect(describeValidation(checkCoverage(parseGherkin(partial), criteria, edgeCases))).toBe(
      "uncovered: AC-2; high-risk edge cases uncovered: EC-1",
    );
    expect(describeValidation(checkCoverage(parseGherkin("nonsense"), criteria, edgeCases))).toBe(
      "1 parse error(s); uncovered: AC-1, AC-2; high-risk edge cases uncovered: EC-1",
    );
    const line = describeValidation(
      failing([{ scenario: "Top-up", line: 3, problem: NO_THEN }], { uncoveredACs: ["AC-2"], uncoveredECs: ["EC-1"] }),
    );
    expect(line).toBe(`uncovered: AC-2; high-risk edge cases uncovered: EC-1; 1 scenario problem(s): "Top-up": ${NO_THEN}`);
  });

  it("shortens a very long scenario name and keeps the line on one line", () => {
    const longName = `Top-up of 20.00 by a returning customer \n\t with   a saved debit card, ${"a very long name, ".repeat(8)}the end`;
    const line = describeValidation(failing([{ scenario: longName, line: 3, problem: NO_THEN }]));
    expect(line).toBe(
      `1 scenario problem(s): "Top-up of 20.00 by a returning customer with a saved debit…": ${NO_THEN}`,
    );
    const shown = /"([^"]*)"/.exec(line)?.[1] ?? "";
    expect(shown.length).toBeLessThanOrEqual(60);
    expect(line).not.toMatch(/[\r\n\t]|\s{2}/);
  });

  it("leaves a scenario name of exactly 60 characters whole", () => {
    const name = "Top-up ".repeat(9).trim().slice(0, 60);
    expect(name).toHaveLength(60);
    expect(describeValidation(failing([{ scenario: name, line: 3, problem: NO_THEN }]))).toBe(
      `1 scenario problem(s): "${name}": ${NO_THEN}`,
    );
  });

  it("says so when the scenario with the problem has no name", () => {
    expect(describeValidation(failing([{ scenario: "  ", line: 3, problem: "The scenario has no name." }]))).toBe(
      "1 scenario problem(s): (unnamed scenario): The scenario has no name.",
    );
  });

  it("shortens the last named problem to keep the line at 320 characters", () => {
    const wordy = `The top-up amount is checked ${"against the daily limit and ".repeat(6)}nothing else.`;
    expect(wordy.length).toBeGreaterThan(190);
    const line = describeValidation(failing([
      { scenario: "Double-tap on confirm", line: 3, problem: NO_TAG },
      { scenario: "Top-up above the daily limit", line: 8, problem: wordy },
      { scenario: "Declined card", line: 12, problem: NO_THEN },
    ]));
    expect(line.length).toBeLessThanOrEqual(320);
    expect(line.length).toBeGreaterThan(300);
    expect(line.startsWith('3 scenario problem(s): "Double-tap on confirm": No @AC-n tag: the scenario is not linked to an acceptance criterion; "Top-up above the daily limit": The top-up amount is checked')).toBe(true);
    expect(line.endsWith("… (and 1 more)")).toBe(true);
  });

  it("names one problem fewer when there is no room for two, and never passes 320 characters", () => {
    const wordy = `The top-up amount is checked ${"against the daily limit and ".repeat(12)}nothing else.`;
    const issues: StepIssue[] = [
      { scenario: "Double-tap on confirm", line: 3, problem: wordy },
      { scenario: "Top-up above the daily limit", line: 8, problem: wordy },
      { scenario: "Declined card", line: 12, problem: NO_THEN },
    ];
    const line = describeValidation(failing(issues));
    expect(line.length).toBeLessThanOrEqual(320);
    expect(line.length).toBeGreaterThan(300);
    expect(line.startsWith('3 scenario problem(s): "Double-tap on confirm": The top-up amount is checked')).toBe(true);
    expect(line).not.toContain("Top-up above the daily limit");
    expect(line.endsWith("… (and 2 more)")).toBe(true);

    // Even a list of uncovered criteria that fills the line by itself cannot push it past the limit.
    const many = Array.from({ length: 80 }, (_, index) => `AC-${index + 1}`);
    const crowded = describeValidation(failing(issues, { uncoveredACs: many }));
    expect(crowded.length).toBeLessThanOrEqual(320);
    expect(crowded.startsWith("uncovered: AC-1, AC-2, AC-3")).toBe(true);
    expect(crowded.endsWith("…")).toBe(true);
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

  describe("Background steps", () => {
    const inputFor = (feature: string): ReportInput => {
      const withBackground = parseGherkin(feature);
      return {
        ...input,
        ambiguities: [],
        feature,
        featureName: withBackground.featureName,
        scenarios: withBackground.scenarios,
        validation: checkCoverage(withBackground, criteria, edgeCases),
        ranking: withBackground.scenarios.map((scenario, index) => ({
          id: scenario.id,
          scenario: scenario.name,
          priority: index === 0 ? "P1" : "P2",
          reason: index === 0 ? "Core flow" : "Common failure",
          tags: scenario.tags,
        })),
      };
    };
    const backgroundInput = inputFor(BACKGROUND);

    it("puts the Background as a block before each scenario's steps in the Jira description", () => {
      const csv = buildJiraCsv(backgroundInput);
      expect(csv).toBe(
        [
          '"Summary","Issue Type","Priority","Labels","Description"',
          [
            '"Test: Successful top-up","Test","High","test-case AC-1","Priority reason: Core flow',
            "",
            "Background:",
            "Given a signed-in customer with a wallet balance of 50.00",
            "And a saved debit card",
            "",
            "Given the customer enters a top-up amount of 20.00",
            "When the customer confirms the top-up",
            'Then the wallet balance is shown as 70.00"',
          ].join("\n"),
          [
            '"Test: Declined card","Test","Medium","test-case AC-2 EC-1","Priority reason: Common failure',
            "",
            "Background:",
            "Given a signed-in customer with a wallet balance of 50.00",
            "And a saved debit card",
            "",
            "When the card is declined",
            'Then the wallet balance is shown as 50.00"',
          ].join("\n"),
          "",
        ].join("\r\n"),
      );
    });

    it("writes each Background step as a comment before the scenario's steps in the Playwright stub", () => {
      const spec = buildPlaywrightSpec(backgroundInput);
      expect(spec).toContain(
        [
          '  test.fixme("Successful top-up", { tag: ["@AC-1","@P1"] }, async ({ page }) => {',
          "    void page;",
          "    // Background: Given a signed-in customer with a wallet balance of 50.00",
          "    // Background: And a saved debit card",
          "    // Given the customer enters a top-up amount of 20.00",
          "    // When the customer confirms the top-up",
          "    // Then the wallet balance is shown as 70.00",
          "  });",
        ].join("\n"),
      );
      expect(spec).toContain(
        [
          "    void page;",
          "    // Background: Given a signed-in customer with a wallet balance of 50.00",
          "    // Background: And a saved debit card",
          "    // When the card is declined",
        ].join("\n"),
      );
      expect(spec.match(/\/\/ Background: /g)).toHaveLength(4);
    });

    it("shows the feature's Background and then the Rule's, only on the Rule's scenarios", () => {
      const ruleInput = inputFor(RULE_BACKGROUND);
      const csv = buildJiraCsv(ruleInput);
      expect(csv).toContain(
        [
          "Background:",
          "Given a signed-in customer with a wallet balance of 50.00",
          "Given the daily limit is 500.00",
          "And the customer has already topped up 450.00 today",
          "",
          "When the customer tops up 60.00",
          'Then the top-up is refused"',
        ].join("\n"),
      );
      expect(csv.match(/the daily limit is 500\.00/g)).toHaveLength(1);
      expect(csv.match(/\nBackground:\n/g)).toHaveLength(3);

      const spec = buildPlaywrightSpec(ruleInput);
      expect(spec).toContain(
        [
          "    // Background: Given a signed-in customer with a wallet balance of 50.00",
          "    // Background: Given the daily limit is 500.00",
          "    // Background: And the customer has already topped up 450.00 today",
          "    // When the customer tops up 60.00",
        ].join("\n"),
      );
      expect(spec.match(/\/\/ Background: Given the daily limit/g)).toHaveLength(1);
    });

    it("keeps the Examples table after the steps when a Scenario Outline has a Background", () => {
      const both = OUTLINE.replace("\n  @AC-1\n", "\n  Background:\n    Given a signed-in customer with a wallet balance of 50.00\n\n  @AC-1\n");
      const bothInput = inputFor(both);
      expect(buildJiraCsv(bothInput)).toContain(
        [
          "Background:",
          "Given a signed-in customer with a wallet balance of 50.00",
          "",
          "Given the card is declined because of <reason>",
          "When the customer confirms the top-up",
          "Then the message names <detail>",
          "",
          "Examples:",
          "| reason | detail |",
        ].join("\n"),
      );
      expect(buildPlaywrightSpec(bothInput)).toContain(
        [
          "    // Background: Given a signed-in customer with a wallet balance of 50.00",
          "    // Given the card is declined because of <reason>",
          "    // When the customer confirms the top-up",
          "    // Then the message names <detail>",
          "    // Examples:",
        ].join("\n"),
      );
    });

    it("keeps a Background step inside its comment whatever line-break characters it contains", () => {
      const hostile = "x\u2028}); require('child_process').exec('id'); test('y', async () => {\r//\u2029z\u0085";
      const [first] = backgroundInput.scenarios;
      const spec = buildPlaywrightSpec({
        ...backgroundInput,
        scenarios: [{ ...first, background: [{ keyword: "Given", kind: "Context", text: hostile }] }],
      });
      const lines = spec.split(/\r\n|[\n\r\u2028\u2029\u0085]/);
      expect(lines.filter((line) => line.includes("child_process"))).toHaveLength(1);
      expect(lines.filter((line) => line.includes("child_process") && !line.trimStart().startsWith("// Background: Given x")).length).toBe(0);
    });

    it("exports a feature with no Background exactly as it did before", () => {
      const plainInput = inputFor(NO_BACKGROUND);
      const csv = buildJiraCsv(plainInput);
      const spec = buildPlaywrightSpec(plainInput);
      expect(csv).not.toContain("Background");
      expect(spec).not.toContain("Background");
      expect(csv).toBe(
        [
          '"Summary","Issue Type","Priority","Labels","Description"',
          '"Test: Successful top-up","Test","High","test-case AC-1","Priority reason: Core flow\n\nGiven the customer enters a top-up amount of 20.00\nWhen the customer confirms the top-up\nThen the wallet balance is shown as 70.00"',
          '"Test: Declined card","Test","Medium","test-case AC-2 EC-1","Priority reason: Common failure\n\nWhen the card is declined\nThen the wallet balance is shown as 50.00"',
          "",
        ].join("\r\n"),
      );
      // A scenario whose background field is an empty list is exported the same way.
      const emptied: ReportInput = { ...backgroundInput, scenarios: backgroundInput.scenarios.map((scenario) => ({ ...scenario, background: [] })) };
      expect(buildJiraCsv(emptied)).toBe(csv);
      expect(buildPlaywrightSpec(emptied)).toBe(spec);
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
