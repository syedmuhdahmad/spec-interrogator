/**
 * Helpers for pulling structured output out of a model reply.
 * Models sometimes wrap JSON in a code fence or add a sentence around it.
 */

const OPENING_FENCE = /```[a-zA-Z0-9_-]*[ \t]*\n/;

/**
 * Returns the body of the fenced code block in a reply, or the trimmed text if
 * there is no fence. The block runs from the first opening fence to the LAST
 * closing one, because the content may itself contain fences (a Gherkin doc
 * string can be written with three backticks).
 */
export function extractFence(text: string): string {
  const open = OPENING_FENCE.exec(text);
  if (!open) return text.trim();
  const bodyStart = open.index + open[0].length;
  const close = text.lastIndexOf("```");
  // No closing fence after the opening one: the reply was cut off. Keep what arrived.
  return (close > bodyStart ? text.slice(bodyStart, close) : text.slice(bodyStart)).trim();
}

/** Parses the first JSON object found in the text. Throws if none parses. */
export function extractJson(text: string): unknown {
  const candidates = [text.trim(), extractFence(text)];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(text.slice(start, end + 1));

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed !== null && typeof parsed === "object") return parsed;
    } catch (error) {
      lastError = error;
    }
  }
  const reason = lastError instanceof Error ? lastError.message : "no JSON object found";
  throw new Error(`Reply was not valid JSON: ${reason}`);
}

/** Collapses whitespace and case so quotes can be compared loosely. */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9'"<>]+/g, " ")
    .trim();
}

/**
 * True when `quote` really appears in `source`. Used to check that an agent's
 * cited line exists in the requirement text and was not made up.
 */
export function quoteAppearsIn(quote: string, source: string): boolean {
  const needle = normalizeForMatch(quote);
  if (needle.length < 3) return false;
  return normalizeForMatch(source).includes(needle);
}
