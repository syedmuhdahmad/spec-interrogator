import { UserFacingError } from "@/lib/core/errors";
import type { IssueRef } from "@/lib/core/types";

/**
 * Read-only access to public GitHub issues.
 *
 * Security: the only host ever contacted is api.github.com, and the owner,
 * repo and issue number are validated against a strict pattern before they
 * are placed in a URL. A user-supplied URL is never fetched directly, so this
 * cannot be turned into a request to an internal address (SSRF).
 */

const API = "https://api.github.com";
const TIMEOUT_MS = 8_000;
const ISSUE_URL = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})\/issues\/(\d{1,9})\/?(?:[?#].*)?$/;

export interface IssueLocator {
  owner: string;
  repo: string;
  number: number;
}

export interface FetchedIssue {
  repo: string;
  url: string;
  title: string;
  body: string;
  labels: string[];
  comments: string[];
}

/** What the pipeline needs from GitHub. The orchestrator depends on this, not on fetch. */
export interface GitHubClient {
  fetchIssue(locator: IssueLocator): Promise<FetchedIssue>;
  searchClosedIssues(repo: string, terms: string): Promise<IssueRef[]>;
}

export function parseIssueUrl(raw: string): IssueLocator {
  const match = ISSUE_URL.exec(raw.trim());
  if (!match || match[2] === "." || match[2] === "..") {
    throw new UserFacingError(
      "That is not a GitHub issue link. Use the form https://github.com/owner/repo/issues/123.",
    );
  }
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

/**
 * Reduces an agent-written query to plain words. Search qualifiers such as
 * `repo:` or `user:` are removed so a query cannot widen the search beyond the
 * repository being analysed.
 */
export function sanitizeSearchTerms(raw: string): string {
  return raw
    .replace(/[A-Za-z_-]+:\S*/g, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1)
    .slice(0, 6)
    .join(" ");
}

interface RawIssue {
  number?: number;
  title?: string;
  body?: string | null;
  html_url?: string;
  labels?: (string | { name?: string })[];
  pull_request?: unknown;
}

function labelNames(labels: RawIssue["labels"]): string[] {
  return (labels ?? [])
    .map((label) => (typeof label === "string" ? label : (label.name ?? "")))
    .filter(Boolean)
    .slice(0, 8);
}

function plain(markdown: string, max: number): string {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

/** Links shown in the UI must point at github.com, whatever the API returned. */
function safeIssueUrl(candidate: string | undefined, repo: string, number: number): string {
  return candidate?.startsWith("https://github.com/") ? candidate : `https://github.com/${repo}/issues/${number}`;
}

export class FetchGitHubClient implements GitHubClient {
  constructor(private readonly token?: string) {}

  private async get(path: string): Promise<unknown> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "spec-interrogator",
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    let response: Response;
    try {
      response = await fetch(`${API}${path}`, {
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "error",
        cache: "no-store",
      });
    } catch {
      throw new UserFacingError("GitHub did not answer in time. Please try again.", 504);
    }

    if (response.status === 404) {
      throw new UserFacingError("GitHub could not find that issue. Only public repositories are supported.", 404);
    }
    if (response.status === 403 || response.status === 429) {
      throw new UserFacingError("GitHub is rate-limiting this app right now. Please try again in a few minutes.", 429);
    }
    if (!response.ok) {
      throw new UserFacingError(`GitHub returned an error (${response.status}).`, 502);
    }
    return response.json();
  }

  async fetchIssue({ owner, repo, number }: IssueLocator): Promise<FetchedIssue> {
    const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}`;
    const issue = (await this.get(base)) as RawIssue;
    if (issue.pull_request) {
      throw new UserFacingError("That link is a pull request. Please use an issue link.");
    }

    let comments: string[] = [];
    try {
      const raw = (await this.get(`${base}/comments?per_page=5`)) as { body?: string | null }[];
      comments = raw.map((comment) => plain(comment.body ?? "", 600)).filter(Boolean);
    } catch {
      // Comments are a bonus; the issue body is enough to continue.
    }

    return {
      repo: `${owner}/${repo}`,
      url: safeIssueUrl(issue.html_url, `${owner}/${repo}`, number),
      title: (issue.title ?? "Untitled issue").slice(0, 200),
      body: plain(issue.body ?? "", 6_000),
      labels: labelNames(issue.labels),
      comments,
    };
  }

  async searchClosedIssues(repo: string, terms: string): Promise<IssueRef[]> {
    const cleaned = sanitizeSearchTerms(terms);
    if (!cleaned || !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo)) return [];

    const query = encodeURIComponent(`repo:${repo} is:issue is:closed ${cleaned}`);
    const result = (await this.get(`/search/issues?q=${query}&per_page=6`)) as { items?: RawIssue[] };
    return (result.items ?? [])
      .filter((item) => typeof item.number === "number" && !item.pull_request)
      .map((item) => ({
        number: item.number as number,
        title: (item.title ?? "").slice(0, 160),
        url: safeIssueUrl(item.html_url, repo, item.number as number),
        labels: labelNames(item.labels),
        snippet: plain(item.body ?? "", 280),
      }));
  }
}
