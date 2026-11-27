import { z } from "zod";

/**
 * Schemas for what each agent must return. They are strict about shape and
 * forgiving about style ("High" vs "high", one item too many), because a run
 * should not fail on formatting when the content is usable.
 */

const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .transform((value) => value.slice(0, max));

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .transform((value) => value.slice(0, max))
    .catch("");

function looseEnum<const T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) {
  return z
    .preprocess((value) => (typeof value === "string" ? value.trim().toLowerCase() : value), z.enum(values))
    .catch(fallback);
}

const cappedArray = <T extends z.ZodType>(item: T, max: number) =>
  z.array(item).transform((items) => items.slice(0, max));

const severity = looseEnum(["high", "medium", "low"], "medium");

export const planSchema = z.object({
  domain: text(80),
  summary: text(400),
  focusAreas: cappedArray(text(120), 6),
  riskLevel: severity,
  notes: optionalText(400),
});

export const criteriaSchema = z.object({
  criteria: cappedArray(
    z.object({
      text: text(400),
      sourceQuote: optionalText(300),
    }),
    10,
  ).refine((items) => items.length > 0, "at least one acceptance criterion is required"),
});

export const ambiguitiesSchema = z.object({
  ambiguities: cappedArray(
    z.object({
      term: text(80),
      quote: optionalText(300),
      whyItMatters: text(400),
      question: text(400),
      severity,
    }),
    10,
  ),
});

export const edgeCasesSchema = z.object({
  edgeCases: cappedArray(
    z.object({
      title: text(160),
      category: text(40),
      relatedAC: optionalText(12),
      severity,
      expected: text(300),
    }),
    10,
  ),
});

export const historyQueriesSchema = z.object({
  queries: cappedArray(text(80), 2).refine((items) => items.length > 0, "at least one search query is required"),
});

export const historyLessonsSchema = z.object({
  summary: text(400),
  lessons: cappedArray(
    z.object({
      lesson: text(300),
      issues: z.array(z.coerce.number().int().positive()).catch([]),
    }),
    5,
  ),
});

export const reviewSchema = z.object({
  verdict: looseEnum(["pass", "revise"], "pass"),
  issues: cappedArray(
    z.object({
      scenario: text(200),
      problem: text(300),
      fix: text(300),
      severity: looseEnum(["major", "minor"], "minor"),
    }),
    6,
  ),
  strengths: cappedArray(text(200), 4).catch([]),
});

export const rankingSchema = z.object({
  ranking: cappedArray(
    z.object({
      id: text(8),
      priority: z
        .preprocess((value) => (typeof value === "string" ? value.trim().toUpperCase() : value), z.enum(["P1", "P2", "P3"]))
        .catch("P2"),
      reason: text(240),
    }),
    40,
  ),
});

/** What the browser may send to /api/run. */
export const runRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    text: z.string().trim().min(1).max(20_000),
    title: z.string().trim().max(120).optional(),
    sampleId: z.string().trim().max(40).optional(),
  }),
  z.object({
    kind: z.literal("github"),
    url: z.string().trim().min(1).max(300),
    sampleId: z.string().trim().max(40).optional(),
  }),
]);

export type RunRequest = z.infer<typeof runRequestSchema>;
