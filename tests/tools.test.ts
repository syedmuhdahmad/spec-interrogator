import { describe, expect, it } from "vitest";
import type { Criterion, EdgeCase } from "@/lib/core/types";
import { checkCoverage } from "@/lib/tools/coverage";
import { buildExports, buildJiraCsv, buildPlaywrightSpec, csvCell, type ReportInput } from "@/lib/tools/exporters";
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

describe("parseGherkin", () => {
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

  it("adds a tag line when a scenario has none", () => {
    const bare = "Feature: X\n  Scenario: Y\n    When a\n    Then b\n";
    const tagged = applyPriorityTags(bare, parseGherkin(bare).scenarios, new Map([["S1", "P2"]]));
    expect(parseGherkin(tagged).scenarios[0].tags).toEqual(["@P2"]);
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
});
