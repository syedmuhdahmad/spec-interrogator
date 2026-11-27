import { describe, expect, it } from "vitest";
import { markClarifications } from "@/lib/tools/clarification";
import { parseGherkin } from "@/lib/tools/gherkin";

const TAG = "@needs-clarification";

/** Scenario name -> its tags, as the official parser sees them. */
function tagsByScenario(feature: string): Record<string, string[]> {
  const parsed = parseGherkin(feature);
  expect(parsed.ok).toBe(true);
  return Object.fromEntries(parsed.scenarios.map((scenario) => [scenario.name, scenario.tags]));
}

describe("markClarifications", () => {
  it("returns text that does not parse unchanged", () => {
    const broken = `Feature: Wallet top-up\n  ${TAG}\n  Scenario: Top-up\n    When the customer tops up <TBD: amount>\n    this line is not Gherkin\n`;
    expect(parseGherkin(broken).ok).toBe(false);
    expect(markClarifications(broken)).toBe(broken);
    expect(markClarifications("")).toBe("");
  });

  it("rescues a file when a stray tag after the very last step is all that stops it parsing", () => {
    // Gherkin refuses a tag line with no scenario under it, so without this the draft would cost a rewrite.
    const feature = `Feature: Wallet top-up\n\n  @AC-1\n  Scenario: Limit\n    When the customer tops up <TBD: maximum amount>\n    Then the top-up is refused\n  ${TAG}\n`;
    expect(parseGherkin(feature).ok).toBe(false);

    const result = markClarifications(feature);
    expect(tagsByScenario(result)).toEqual({ Limit: ["@AC-1", TAG] });
    expect(result.match(/@needs-clarification/g)).toHaveLength(1);
    expect(markClarifications(result)).toBe(result);

    // The same stray tag does not excuse a file that is broken in another way as well.
    const stillBroken = feature.replace("    Then the top-up is refused\n", "    Then the top-up is refused\n    this line is not Gherkin\n");
    expect(markClarifications(stillBroken)).toBe(stillBroken);
  });

  it("keeps Windows line endings on the lines it edits", () => {
    const feature = [
      "Feature: Wallet top-up",
      "",
      `  @AC-1 ${TAG}`,
      "  Scenario: Successful top-up",
      "    When the customer tops up 20.00",
      "    Then the balance increases by 20.00",
      "",
      "  @AC-2",
      "  Scenario: Limit",
      "    When the customer tops up <TBD: maximum amount>",
      "    Then the top-up is refused",
      "",
      "  Scenario: Refund",
      "    When a top-up is refunded",
      "    Then the customer sees <TBD: refund message>",
      "",
    ].join("\r\n");
    const result = markClarifications(feature);

    expect(result.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(tagsByScenario(result)).toEqual({ "Successful top-up": ["@AC-1"], Limit: ["@AC-2", TAG], Refund: [TAG] });
  });

  it("moves a tag written after a scenario's last step off the next scenario and onto the one with the placeholder", () => {
    const feature = [
      "Feature: Wallet top-up",
      "",
      "  @AC-1",
      "  Scenario: Large top-up",
      "    When the customer tops up <TBD: amount that needs verification>",
      "    Then extra verification is requested",
      `  ${TAG}`,
      "",
      "  @AC-2",
      "  Scenario: Small top-up",
      "    When the customer tops up 20.00",
      "    Then the balance increases by 20.00",
      "",
    ].join("\n");
    // The fault this tool exists for: Gherkin gives the stray line to the scenario below it.
    expect(tagsByScenario(feature)).toEqual({ "Large top-up": ["@AC-1"], "Small top-up": [TAG, "@AC-2"] });

    const result = markClarifications(feature);
    expect(tagsByScenario(result)).toEqual({ "Large top-up": ["@AC-1", TAG], "Small top-up": ["@AC-2"] });
    expect(result.match(/@needs-clarification/g)).toHaveLength(1);
    expect(result).toContain(`  @AC-1 ${TAG}\n  Scenario: Large top-up`);
  });

  it("tags a Scenario Outline whose only placeholder is in its Examples table", () => {
    const feature = [
      "Feature: Wallet top-up",
      "",
      "  @AC-1",
      "  Scenario Outline: Top-up limits",
      "    When the customer tops up <amount>",
      '    Then the message "<message>" is shown',
      "",
      "    Examples:",
      "      | amount | message                       |",
      "      | 0      | Enter an amount               |",
      "      | 999999 | <TBD: message above the limit> |",
      "",
      "  @AC-2",
      "  Scenario: Declined card",
      "    When the card is declined",
      "    Then an error is shown",
      "",
    ].join("\n");

    expect(tagsByScenario(markClarifications(feature))).toEqual({
      "Top-up limits": ["@AC-1", TAG],
      "Declined card": ["@AC-2"],
    });
  });

  it("gives a scenario with no tag line one, indented like its Scenario line", () => {
    const feature = "Feature: Wallet top-up\n\n    Scenario: Refund\n      When a top-up is refunded\n      Then the customer sees <tbd: refund message>\n";
    const result = markClarifications(feature);

    expect(result).toContain(`\n    ${TAG}\n    Scenario: Refund\n`);
    expect(tagsByScenario(result)).toEqual({ Refund: [TAG] });
  });

  it("removes the tag from a scenario that has no placeholder, however it was written", () => {
    const feature = [
      "Feature: Wallet top-up",
      "",
      "  @AC-1 @Needs-Clarification @EC-2   # checked by hand",
      "  Scenario: Successful top-up",
      "    When the customer tops up 20.00",
      "    Then the balance increases by 20.00",
      "",
      `  ${TAG}`,
      "  Scenario: Declined card",
      "    When the card is declined",
      "    Then an error is shown",
      "",
    ].join("\n");
    const result = markClarifications(feature);

    expect(tagsByScenario(result)).toEqual({ "Successful top-up": ["@AC-1", "@EC-2"], "Declined card": [] });
    expect(result).toContain("  @AC-1 @EC-2   # checked by hand\n");
    expect(result).not.toMatch(/needs-clarification/i);
  });

  it("puts the tag before a comment that ends the tag line", () => {
    const feature = "Feature: Wallet top-up\n\n  @AC-1 # limits\n  Scenario: Limit\n    When the customer tops up <TBD: maximum amount>\n    Then the top-up is refused\n";
    const result = markClarifications(feature);

    expect(result).toContain(`  @AC-1 ${TAG} # limits\n`);
    expect(tagsByScenario(result)).toEqual({ Limit: ["@AC-1", TAG] });
  });

  it("does not count a placeholder in the next scenario's header, or in the Background, as this scenario's", () => {
    const feature = [
      "Feature: Wallet top-up",
      "",
      "  Background:",
      "    Given a wallet with a balance of <TBD: opening balance>",
      "",
      "  @AC-1",
      "  Scenario: Successful top-up",
      "    When the customer tops up 20.00",
      "    Then the balance increases by 20.00",
      "",
      "  @AC-2",
      "  # <TBD: confirm the wording with the client>",
      "  Scenario: Declined card",
      "    When the card is declined",
      "    Then an error is shown",
      "",
    ].join("\n");

    expect(markClarifications(feature)).toBe(feature);
  });

  it("leaves a doc string alone even when one of its lines looks like the tag", () => {
    const feature = [
      "Feature: Wallet top-up",
      "",
      "  @AC-1",
      "  Scenario: Receipt",
      "    When the customer tops up 20.00",
      "    Then the receipt reads",
      '      """',
      `      ${TAG}`,
      '      """',
      "",
    ].join("\n");

    expect(markClarifications(feature)).toBe(feature);
  });

  it("is idempotent", () => {
    const feature = [
      `@wallet ${TAG}`,
      "Feature: Wallet top-up",
      "",
      `  ${TAG} @AC-1 # limits`,
      "  Scenario: Limit",
      "    When the customer tops up <TBD: maximum amount>",
      "    Then the top-up is refused",
      `  ${TAG}`,
      "",
      "  Scenario: Refund",
      "    When a top-up is refunded",
      "    Then the customer sees <TBD: refund message>",
      "",
      `  @AC-2 ${TAG}`,
      "  Scenario: Declined card",
      "    When the card is declined",
      "    Then an error is shown",
      "",
    ].join("\n");

    const once = markClarifications(feature);
    expect(once).not.toBe(feature);
    expect(markClarifications(once)).toBe(once);
    expect(tagsByScenario(once)).toEqual({ Limit: ["@AC-1", TAG], Refund: [TAG], "Declined card": ["@AC-2"] });
    expect(once.split("\n")[0]).toBe("@wallet");
  });
});
