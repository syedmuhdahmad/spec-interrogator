import { parseGherkin } from "./gherkin";

const TAG = "@needs-clarification";
const PLACEHOLDER = /<TBD/i;

/**
 * Makes the @needs-clarification tag a fact computed by code: a scenario
 * carries it exactly when its text contains a "<TBD ...>" placeholder.
 *
 * A model cannot be trusted with this tag. Written on its own line after a
 * scenario's last step, it belongs to the NEXT scenario in Gherkin, and the
 * file still parses. So every copy the model wrote is removed, wherever it
 * is, and the tag is put back on the scenarios that have a placeholder.
 *
 * The tag is removed before the first parse, because a copy written after the
 * very last step is the one thing here that stops a file parsing: Gherkin
 * refuses a tag line with no scenario under it. Text that still does not
 * parse without the tag is returned unchanged (the fix round deals with it),
 * and so is the original if adding the tag back would break the file.
 */
export function markClarifications(feature: string): string {
  const lines = stripTag(feature.split("\n"));
  const parsed = parseGherkin(lines.join("\n"));
  if (!parsed.ok) return feature;

  // Decide from the untouched lines first, then edit from the bottom up so
  // the line numbers of the scenarios still to be edited stay correct.
  const marked = parsed.scenarios.filter((scenario, index) => {
    const next = parsed.scenarios[index + 1];
    const end = next ? headerStart(lines, next.line - 1, scenario.line - 1) : lines.length;
    return PLACEHOLDER.test(lines.slice(scenario.line - 1, end).join("\n"));
  });

  for (const scenario of [...marked].sort((a, b) => b.line - a.line)) {
    if (scenario.tagLine) {
      const index = scenario.tagLine - 1;
      const { tags, comment, eol } = splitTagLine(lines[index]);
      lines[index] = `${tags} ${TAG}${comment}${eol}`;
    } else {
      const index = scenario.line - 1;
      const line = lines[index] ?? "";
      const indent = /^[ \t]*/.exec(line)?.[0] ?? "  ";
      lines.splice(index, 0, `${indent}${TAG}${lineEnd(line)}`);
    }
  }

  const result = lines.join("\n");
  return parseGherkin(result).ok ? result : feature;
}

/** The "\r" of a Windows line ending, which splitting on "\n" leaves behind and an edit must keep. */
function lineEnd(line: string): string {
  return line.endsWith("\r") ? "\r" : "";
}

/** A tag line may end in a comment; tags are edited in front of it. */
function splitTagLine(line: string): { tags: string; comment: string; eol: string } {
  const eol = lineEnd(line);
  const body = eol ? line.slice(0, -1) : line;
  const comment = /\s+#.*$/.exec(body);
  return comment ? { tags: body.slice(0, comment.index), comment: comment[0].trimEnd(), eol } : { tags: body.trimEnd(), comment: "", eol };
}

/**
 * Removes the tag from every tag line and drops a line left empty by that.
 * Lines inside a doc string are text, not tags, and are left alone.
 */
function stripTag(lines: string[]): string[] {
  const kept: string[] = [];
  let docString: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    const delimiter = /^("""|```)/.exec(trimmed)?.[1];
    if (delimiter && (!docString || docString === delimiter)) {
      docString = docString ? undefined : delimiter;
      kept.push(line);
      continue;
    }
    if (docString || !trimmed.startsWith("@")) {
      kept.push(line);
      continue;
    }

    const { tags, comment, eol } = splitTagLine(line);
    const names = tags.trim().split(/\s+/);
    const remaining = names.filter((name) => name.toLowerCase() !== TAG);
    if (remaining.length === names.length) {
      kept.push(line);
      continue;
    }
    const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
    if (remaining.length) kept.push(`${indent}${remaining.join(" ")}${comment}${eol}`);
    else if (comment) kept.push(`${indent}${comment.trim()}${eol}`);
  }
  return kept;
}

/**
 * The index where a scenario's header starts: its first tag line, or its
 * Scenario line when it has no tags. Blank lines and comments between the
 * tag lines and the Scenario line belong to the header.
 */
function headerStart(lines: string[], scenarioIndex: number, floor: number): number {
  let start = scenarioIndex;
  for (let index = scenarioIndex - 1; index > floor; index -= 1) {
    const trimmed = lines[index].trim();
    if (trimmed.startsWith("@")) start = index;
    else if (trimmed !== "" && !trimmed.startsWith("#")) break;
  }
  return start;
}
