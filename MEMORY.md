# Shared memory for AI agents

Every agent working on this repository reads this file first and updates it before finishing. It holds what the code and the README cannot tell you: where things stand, what was measured, what was decided and why, and what went wrong before.

**Rules for this file**

- This repository is public. Never write a key, a token, the gateway address, an email address or anything private here.
- Keep "Where things stand" and "Next steps" current: rewrite them, do not append.
- Add one dated entry to "Session log" at the end of each working session. Newest first. Keep it to what the next agent needs.
- If something here turns out to be wrong, fix it here. Do not leave a contradiction.
- `CLAUDE.md` holds the rules. `README.md` describes the product. `docs/ROADMAP.md` and the GitHub milestones hold the plan. Do not copy them here; point to them.

## Where things stand

Last updated: Fri 27 Nov 2026, 14:55 PKT.

- **Deadline:** submissions close Mon 30 Nov 2026 at 2:00 PM PKT. Aim to submit by 10:00 AM. The app must stay live until winners are announced in mid-December.
- **Live:** https://spec-interrogator.vercel.app, deployed from `main` by Vercel (project `spec-interrogator`). Every push to `main` redeploys. A changed environment variable needs a redeploy to take effect.
- **Repo:** `syedmuhdahmad/spec-interrogator`, public. CI (GitHub Actions) runs the secret scan, lint, type-check, tests and build on every push.
- **Phase 1 (Foundation) is done.** The whole pipeline works on the live site with the real models. 134 tests pass.
- **Phase 2 (Live tuning) is under way.** Only one of the four samples (CASE 01, wallet top-up) has been run live, most recently on the 27 Nov midday code. The other three have never been run against the real models.
- **That CASE 01 run showed four more weaknesses, now fixed in code and prompts** (commits "Carry Background steps into the exports and name what the Validator rejected" and "Show the Skeptic the open questions and keep placeholders narrow"). The two prompt changes are unconfirmed until the next live run.
- **The six weaknesses from the second real run are fixed, and a third real run on the same story confirmed most of it.** Four held fully (no invented outcomes, the `@needs-clarification` tag in the right place, Examples in the exports, the Analyst keeps the actor). Two held mostly: 2 of 8 questions still join two decisions with "and" (it was 5 of 8 with three each), and one Risk Ranker reason still cites a loosely related question. The Skeptic did not object to placeholders. This is one story only; the samples have not been checked.
- **Three export defects from that third run are fixed in code and tested** (commit "Name uncovered edge cases, keep the clarification tag in stubs, tidy file names").
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

CASE 01 again on the 27 Nov midday code, with both loops firing (one Validator fix round, one Skeptic revision): 9 model calls, 30,688 tokens, 68 s, about $0.20 at the assumed prices (summed from the Log tab, not read off the screen). 6 of 6 criteria, 6 of 7 edge cases, 9 scenarios. The Test Designer ran three times and used 16,363 of the tokens. So a run costs about $0.10 when the first draft passes and about $0.20 when both loops fire.

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
- **Code owns the `@needs-clarification` tag.** `lib/tools/clarification.ts` strips it wherever the model wrote it and puts it on every scenario that contains a `<TBD` placeholder. The models are told not to write it.
- **The Test Designer and the Risk Ranker are given the open questions** (term and question only, at most eight). Without them the suite asserted answers to things the Ambiguity Hunter had listed as undecided.
- **The Skeptic is given the open questions too.** In a live run it called a placeholder scenario for an open question ("how fast is fast") an invented rule, and the revision dropped it, leaving that question with no test.
- **A placeholder covers the undecided part only, and a Then step must be observable.** The Test Designer is told both. A live run had scenarios whose Then steps were all placeholders, and one Then step that named an internal mechanism.
- **Background steps live in `ScenarioInfo.background`, not in `steps`.** The coverage check and the step count see only a scenario's own steps; the Jira CSV and the Playwright stubs print the Background before them.
- **The Validator's timeline line names the first two scenario problems** (at most 320 characters). A bare count told neither a judge nor a developer what was sent back.
- **A tag line that follows a step is not rejected by the Validator.** A model that leaves no blank line between scenarios would trip that check on every scenario. Code owning the tag fixes the case that was seen.

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
- **A Gherkin tag line written after a scenario's last step belongs to the next scenario, and the file still parses.** After the very last scenario it does not parse at all. Never trust a model with where a tag goes.
- **The Log tab has no output text.** To review a run, ask the owner for the Log tab, the downloaded test plan (it holds the client questions in full) and the `.feature` file.
- **When a retry succeeds, the reason is now on the timeline** ("Needed one retry: ..."). Before 27 Nov it was only in the server log.
- **Check the commit author before committing.** This machine's default git identity is not the address this repository's history uses. `git log -1 --format=%ae` should end in `users.noreply.github.com`. Five commits had to be re-authored before a push because of this.
- **Prompt changes cannot be proven offline.** The scripted-model tests prove what a prompt contains and what the code does with a reply, not that the real models comply.
- **Check escapes after an edit.** An editing tool has twice turned the escape sequences for U+2028 and U+2029 into the raw characters, which broke a pattern and then a test file. After editing a file that holds them, search it for the raw characters.
- **Two `pipeline-builder` agents can work at once** if each is given its own list of files and told not to touch the other's.

## Open risks

1. **Budget drain.** Rate limits live in each server instance's memory, so they slow abuse down and do not enforce a daily cap. See issue #17.
2. **No replay fallback yet.** See issue #13.
3. **Cancellation on Vercel is untested.** `vercel.json` sets `supportsCancellation` for the run route as Vercel's docs describe, but nobody has confirmed on the live site that pressing Stop ends the model calls.
4. **Three samples are untested live.** The GitHub sample (`microsoft/playwright` issue 30976) was picked from a search listing and has never been fetched by the app.
5. **No loop appears when the first draft passes.** That is correct, but judges then do not see the Validator send work back. Consider whether a sample should reliably show one. The owner has not decided.
6. **Many placeholder steps on a vague story.** On CASE 01, 8 of 9 scenarios held a `<TBD: ...>` step and three had nothing else in their Then steps. The Test Designer prompt was narrowed for this; the effect is unconfirmed. Watch both ways: too many placeholders, or the suite going back to asserting undecided things.
7. **"Addressed in the revision" is not verified.** The chip and the test plan heading appear when a revised suite passes the parser and the coverage check. Nothing checks that the Skeptic's objections were really fixed. In the third real run all four notes were in fact fixed (checked by hand). The notes can name scenarios that the revision renamed.
8. **No code checks that a Then step is observable.** "Then it works" passes the Validator; only the Skeptic can catch it.
9. **Jira import is untested.** The Examples table header is written as an ordinary row, and nobody has imported the CSV into Jira.
10. **A question can have no test.** The Analyst now keeps to the requirement's own list of criteria, so a task line that is not an acceptance criterion may get a client question and no scenario. Seen once from this cause; do not change the Analyst prompt unless a sample shows it too. (A second case on CASE 01 had another cause, the Skeptic, and is fixed.)
11. **The limit of eight questions can crowd one out.** Splitting bundled questions used the slots, and a question about an expected value that the earlier run asked was missing; the suite then asserted that value without a placeholder.
12. **The longer Validator line has not been seen in a browser.** It can now be up to 320 characters on the timeline and in the Log tab. It is plain wrapping text, so it should be fine, but nobody has looked.
13. **A placeholder inside a Background step tags nothing.** `lib/tools/clarification.ts` looks at each scenario's own block, on purpose. Such a step now shows in both exports with no `@needs-clarification` label.
14. **What the Validator rejected on CASE 01 is unknown.** The run predates the named line; it said only "3 scenario problem(s)". The next run that loops will say.

## Next steps

In order. Each has a GitHub issue under its milestone.

1. Run CASE 02, CASE 03 and the GitHub sample live, read the output as a QA lead would, and tune prompts (#9, #11, #12). Ask the owner for the Log tab as well as the files. On the first run after the 27 Nov afternoon push, check the two new prompt rules: the Skeptic leaves placeholder scenarios alone, and no scenario is all placeholders. Watch for open risks 6, 10 and 11, and read what the Validator names if it sends a draft back. Each run costs about $0.10 to $0.15, more with a revision round. The owner runs them and pastes the output. Ask before spending.
2. Decide with the owner whether a sample should reliably show a feedback loop. Give options and a recommendation; do not fake a loop. New evidence: the last two real runs both produced a genuine Skeptic revision, and CASE 01 also a Validator fix round, so loops do happen unprompted. A looping run costs about twice a clean one.
3. Compare the on-screen cost estimate with real LiteLLM spend and set `PRICE_MAIN` / `PRICE_FAST` if needed (#10).
4. Add `GITHUB_TOKEN` (fine-grained, public repositories, read-only) on Vercel and redeploy (#12). The owner does this.
5. Confirm on the live site that Stop cancels a run. Tell the owner how it will be checked before doing it.
6. Record replays with `npm run record` and commit `public/replays/` (#13). Ask first: it costs about four runs.
7. Phase 3: accessibility pass, browsers and a phone, README with live screenshots (#14, #15, #16).
8. Phase 4: run the `hackathon-guard` agent, then submit (#18, #19, #20).

## Session log

### Fri 27 Nov 2026 (Claude Code on the owner's machine, early afternoon)

- The midday commits were pushed and deployed. The owner connected the Vercel connector for read-only use (deployment status and runtime logs). The plan keeps runtime logs for about one hour, and a clean run writes nothing to them.
- Reviewed a third real run from its four export files, on the same non-sample story as the second, so the two could be compared line by line. See "Where things stand" for what held.
- Fixed three export defects it showed, with tests (102 to 109): Playwright stubs lost the `@needs-clarification` tag, file names could end in a hyphen, and the test plan did not name the edge cases with no scenario.
- The owner then ran CASE 01 on that code and pasted the Log tab and all four files. Both loops fired. It confirmed the three export fixes live and showed four more weaknesses, fixed with tests (109 to 134): Background steps were missing from the Jira CSV and the stubs, the Validator's line was only a count, the Skeptic had a placeholder scenario dropped, and placeholders were over-used.
- The owner said "not now" to adding server log lines for the Stop check, so that check is parked.
- Still open: CASE 02, CASE 03 and the GitHub sample are unrun, and the loop decision has not been put to the owner.

### Fri 27 Nov 2026 (Claude Code on the owner's machine, midday)

- `npm run verify` passed on arrival. Read every agent prompt, the orchestrator and the tests before changing anything.
- Reviewed a second real run from its exported files. It was on a story that is not one of the samples, so the tests for what it showed use made-up wallet text. Only public or made-up text goes into this repository, its tests and its issues.
- That run was strong on questions and coverage, and the Skeptic behaved well. It showed six weaknesses: the suite assumed answers to open questions, a `@needs-clarification` tag landed on the wrong scenario, Scenario Outlines lost their Examples in the exports, the Analyst changed who acts, questions bundled several decisions, and one Risk Ranker reason cited an unrelated question.
- Fixed all six with tests (75 to 102). See "Decisions" and "Lessons learned" above. The prompt parts are unconfirmed until a live run.
- The `hackathon-guard` audit passed every rule check and blocked the push over the commit author address. The commits were re-authored, then pushed.
- CASE 02, CASE 03 and the GitHub sample are still not run live. The loop decision and the Stop check have not been started.

### Fri 27 Nov 2026 (cloud session, morning)

- Built the whole app from an empty folder: Next.js 16, eight agents, five code tools, orchestrator with capped loops, streaming API, UI, tests, CI, README, roadmap, two project agents.
- Created four milestones and twenty issues. Closed the eight that are done.
- An independent review found eleven problems. Nine were fixed (commit `6adf649`). Two remain as issues #13 and #17.
- First live run exposed the token-cap problem. Fixed in commit `ac38a4f`. Second live run passed every check.
- Handed over to Claude Code on the owner's machine.
