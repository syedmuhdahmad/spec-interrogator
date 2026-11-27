/**
 * Request checks for the public API route.
 */

/** Largest request body the run endpoint will read, in bytes. */
export const MAX_BODY_BYTES = 32_000;

/**
 * The visitor's address as reported by the hosting platform. On Vercel the
 * left-most x-forwarded-for entry is set by the edge and cannot be spoofed by
 * the client. Used only as a rate-limit key; never stored or logged.
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-vercel-forwarded-for") ?? headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * True when a browser request comes from this site's own pages. Browsers
 * always send Origin on a cross-site POST, so this stops other websites from
 * spending the app's LLM budget through their visitors. Tools that send no
 * Origin (curl, tests) are allowed here and handled by the rate limiter.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") !== "cross-site";
  try {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Reads a request body as text, refusing anything over the size limit. */
export async function readBodyLimited(request: Request, maxBytes: number = MAX_BODY_BYTES): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
