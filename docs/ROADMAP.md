# Roadmap

Submissions close Monday 30 November 2026 at 2:00 PM PKT. Each phase is a GitHub milestone with its issues.

| Phase | When | Goal |
| --- | --- | --- |
| 1. Foundation | Fri 27 Nov | Whole pipeline working end to end with tests, deployed on Vercel, first live run |
| 2. Live tuning | Sat 28 Nov | Prompts tuned on real model output; cost and time per run measured |
| 3. Judge-proofing | Sun 29 Nov | Recorded replays, demo switch tested, accessibility and browser checks, README final |
| 4. Submit and keep alive | Mon 30 Nov, by 10 AM | Final checks, submit, then watch the budget until winners are announced |

## Phase 1: Foundation

- [x] Next.js app, core types, schemas, config
- [x] LLM layer behind an interface (LiteLLM client, mock client, usage meter)
- [x] Eight agents and five code tools
- [x] Orchestrator with capped feedback loops and graceful degradation
- [x] Streaming API route with rate limits and request checks
- [x] UI: samples, live timeline, results tabs, downloads
- [x] 75 tests, secret scanner, CI
- [x] Vercel project connected, environment variables set
- [x] First live run against the real models

## Phase 2: Live tuning

- [x] Confirm model names with the gateway's `/models` endpoint
- [ ] Run the three made-up samples live; fix whatever the real model does differently from the mock
- [ ] Tune prompts for specificity (questions that quote the text, assertions that check something)
- [ ] Measure tokens, cost and time per run; adjust `maxTokens` and `LIMITS`
- [ ] Confirm the GitHub sample issue and add `GITHUB_TOKEN`

## Phase 3: Judge-proofing

- [ ] Record replays for all samples (`npm run record`) and commit them
- [ ] Test `DEMO_MODE=replay` on a preview deployment
- [ ] Accessibility pass: keyboard only, screen reader labels, contrast
- [ ] Check on a phone and in Firefox and Safari
- [ ] README: live URL, final screenshots
- [ ] Stretch: shared rate-limit store

## Phase 4: Submit and keep alive

- [ ] Run the `hackathon-guard` agent; fix anything blocking
- [ ] Open the production URL in a private window; confirm the latest deployment is Ready
- [ ] Submit repo URL, production URL and the summary (600 characters or fewer)
- [ ] Check LiteLLM spend daily until winners are announced; switch to replay mode if it runs low
