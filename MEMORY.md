# Shared memory for AI agents

Every agent working on this repository reads this file first and updates it before finishing. It holds what the code and the README cannot tell you: where things stand, what was measured, what was decided and why, and what went wrong before.

**Rules for this file**

- This repository is public. Never write a key, a token, the gateway address, an email address or anything private here.
- Keep "Where things stand" and "Next steps" current: rewrite them, do not append.
- Add one dated entry to "Session log" at the end of each working session. Newest first. Keep it to what the next agent needs.
- If something here turns out to be wrong, fix it here. Do not leave a contradiction.
- `CLAUDE.md` holds the rules. `README.md` describes the product. `docs/ROADMAP.md` and the GitHub milestones hold the plan. Do not copy them here; point to them.

## Where things stand

Last updated: Fri 27 Nov 2026, 11:30 PKT.

- **Deadline:** submissions close Mon 30 Nov 2026 at 2:00 PM PKT. Aim to submit by 10:00 AM. The app must stay live until winners are announced in mid-December.
- **Live:** https://spec-interrogator.vercel.app, deployed from `main` by Vercel (project `spec-interrogator`). Every push to `main` redeploys. A changed environment variable needs a redeploy to take effect.
- **Repo:** `syedmuhdahmad/spec-interrogator`, public. CI (GitHub Actions) runs the secret scan, lint, type-check, tests and build on every push.
- **Phase 1 (Foundation) is done.** The whole pipeline works on the live site with the real models. 75 tests pass.
- **Phase 2 (Live tuning) has started.** Only one of the four samples (CASE 01, wallet top-up) has been run live. The other three have never been run against the real models.
- **No recorded replays exist yet.** `public/replays/` is empty, so `DEMO_MODE=replay` has nothing to show.

## Facts worth knowing

- **Models:** `claude-sonnet-5-5` (main) and `claude-haiku` (fast), through the organisers' LiteLLM gateway. Both names work. The gateway allows 60 requests a minute.
- **Budget:** $25 in total for the key, no refill, valid until about 29 December. It must also cover the judges' runs. About $0.35 (estimated) was spent on the first two live runs.
- **The on-screen cost is an estimate.** It uses assumed prices ($3/$15 per million tokens for the main model, $1/$5 for the fast one). Nobody has compared it with real LiteLLM spend yet.
- **The owner works on Windows.** Use `curl.exe`, not `curl`, in PowerShell. Set a variable for one command with `$env:MOCK_LLM=1; npm run dev`.
- **Environment variables on Vercel:** the four LiteLLM ones are set. `GITHUB_TOKEN` is not set yet.
- **Hackathon judging:** five equally weighted criteria (completeness, creativity, technical execution, presentation and live product, business value). Judges open the live URL on their own, with nobody presenting. The organisers say visible agent steps and agents checking each other's results raise the completeness score.

## Measurements

CASE 01 (wallet top-up) on the production URL, 27 Nov:

| | Before tuning | After tuning (commit `ac38a4f`) |
| --- | --- | --- |
| Result | 7 of 8 criteria covered, no ranking | 7 of 7 criteria, 8 of 8 edge cases, all checks passed |
| Model calls | 12 | 7 |
| Tokens | 41,243 | 16,190 |
| Time | 1 min 42 s | 43 s |
| Loops | 2 fix rounds, both failed | 0 (first draft passed) |
| Estimated cost | not captured | $0.105 |

Per-agent tokens in the tuned run: Planner 773, Analyst 1,338, Ambiguity Hunter 2,200, Edge-Case Explorer 2,263, Test Designer 2,972, Skeptic 4,339, Risk Ranker 2,305.

## Decisions, and why

- **Parsing and coverage are code, not model calls.** They are facts to compute. This is also the app's best argument that the agents really check each other.
- **Ids are assigned by code** (`AC-1`, `EC-1`, `S1`), and everything a model cites is checked in code. Models invent references.
- **The Skeptic only reviews a suite that passed the checks.** Reviewing a broken suite wastes tokens.
- **A revision that fails the checks is thrown away** in favour of the earlier valid suite.
- **Optional steps never fail the run.** Only the Analyst and the first draft are required. A late gateway error must not discard a suite that is already written.
- **A fix round asks only for the missing scenarios** when the file is sound and only coverage is missing; code appends them. A full rewrite risks hitting the token cap and dropping coverage that existed.
- **Fonts are bundled** (`@fontsource`), so the browser makes no third-party requests and the Content Security Policy can stay same-origin only.
- **Requests without an `Origin` header are refused.** Browsers always send one on a POST. This turns away casual scripts. It is not authentication.
- **The per-IP limit is loose on purpose** (6 runs per 10 minutes). Judges may share one office address.
- **The history tool uses a two-turn JSON pattern, not native function calling.** Nobody has confirmed that the gateway passes tool calls through, and this works either way.
- **No database.** Nothing a visitor pastes is stored.

## Lessons learned

- **The real models write far more than the mock.** With the first token caps, four of six agents were cut off and retried, and the Risk Ranker failed twice. Fixed with higher caps in `lib/agents/registry.ts` and a length limit on every field in every prompt. When adding a field to a prompt, give it a length limit.
- **A cut-off Gherkin file can still parse.** It must be rejected on the `truncated` flag, not on the parser's verdict.
- **Type-check from a clean checkout before trusting it.** `LayoutProps` is a global type Next.js generates during a build, so `tsc` passed locally and failed in CI. Do not use Next.js generated global types.
- **This is Next.js 16 with Cache Components on.** Several APIs differ from older versions. Read `node_modules/next/dist/docs/` before using one.
- **Avoid the letters "sk" followed by a hyphen anywhere in tracked files**, including inside ordinary words written with a hyphen after "risk". The organisers tell judges to search repositories for that key prefix, and a naive search would match. Write "ranked by risk" instead.
- **After `next build`, restart `next start`.** A server left running from the previous build serves pages whose CSS and JavaScript no longer exist.
- **To call `/api/run` with a script, send an `Origin` header that matches the host.** Without it the answer is 403.
- **The local rate limiter is shared by everything on `localhost`** (the key is "unknown"). After six runs in ten minutes the server answers 429. Restart it to reset.
- **The Vercel project only lists repositories owned by the GitHub user connected to that Vercel account.**

## Open risks

1. **Budget drain.** Rate limits live in each server instance's memory, so they slow abuse down and do not enforce a daily cap. See issue #17.
2. **No replay fallback yet.** See issue #13.
3. **Cancellation on Vercel is untested.** `vercel.json` sets `supportsCancellation` for the run route as Vercel's docs describe, but nobody has confirmed on the live site that pressing Stop ends the model calls.
4. **Three samples are untested live.** The GitHub sample (`microsoft/playwright` issue 30976) was picked from a search listing and has never been fetched by the app.
5. **No loop appears when the first draft passes.** That is correct, but judges then do not see the Validator send work back. Consider whether a sample should reliably show one.

## Next steps

In order. Each has a GitHub issue under its milestone.

1. Run CASE 02, CASE 03 and the GitHub sample live, read the output as a QA lead would, and tune prompts (#9, #11, #12). Each run costs about $0.10 to $0.15. Ask the owner before spending.
2. Compare the on-screen cost estimate with real LiteLLM spend and set `PRICE_MAIN` / `PRICE_FAST` if needed (#10).
3. Add `GITHUB_TOKEN` (fine-grained, public repositories, read-only) on Vercel and redeploy (#12). The owner does this.
4. Confirm on the live site that Stop cancels a run.
5. Record replays with `npm run record` and commit `public/replays/` (#13). Ask first: it costs about four runs.
6. Phase 3: accessibility pass, browsers and a phone, README with live screenshots (#14, #15, #16).
7. Phase 4: run the `hackathon-guard` agent, then submit (#18, #19, #20).

## Session log

### Fri 27 Nov 2026 (cloud session, morning)

- Built the whole app from an empty folder: Next.js 16, eight agents, five code tools, orchestrator with capped loops, streaming API, UI, tests, CI, README, roadmap, two project agents.
- Created four milestones and twenty issues. Closed the eight that are done.
- An independent review found eleven problems. Nine were fixed (commit `6adf649`). Two remain as issues #13 and #17.
- First live run exposed the token-cap problem. Fixed in commit `ac38a4f`. Second live run passed every check.
- Handed over to Claude Code on the owner's machine.
