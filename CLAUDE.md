# Spec Interrogator: rules for AI coding agents

This is Syed Muhammad Ahmad's entry for the SSI Agent-A-Thon 2026. Read `README.md` for what the app does and `AGENTS.md` for the Next.js 16 notes (this version differs from older ones: check `node_modules/next/dist/docs/` before using a Next.js API).

## Hackathon rules that override everything else

1. **Never write a key, token or gateway address into any file that git tracks.** Settings live in `.env.local` (ignored) and in Vercel. Do not read `.env.local`. Do not print environment values. An API key in the repository disqualifies the entry.
2. **Public or made-up data only.** No client, customer or internal company data in samples, tests, fixtures or screenshots.
3. **Accept Edits mode, never full auto.** `.claude/settings.json` sets this. Do not change it.
4. **Every loop has a hard cap.** The caps are in `lib/config.ts` (`LIMITS`). Never add a loop or a retry without a cap and a test that proves the cap holds.
5. **The key has a fixed $25 budget that must last through judging.** Do not run live model calls in tests. Use `MOCK_LLM=1` for development. Ask before running `npm run record`.

## Before every commit

```bash
npm run verify   # secret scan, lint, type-check, tests, build
```

Commit only when it passes. Use the `hackathon-guard` agent for a second look before pushing.

## How the code is organised

- `lib/orchestrator.ts` decides order, parallelism, loops and what happens when a step fails. It receives its dependencies as arguments.
- `lib/agents/<name>.ts`: one agent per file. It holds the prompt and the code checks on that agent's output. It calls the model only through `runJsonAgent` or `runFencedAgent` in `lib/agents/base.ts`.
- `lib/agents/registry.ts` lists every step (name, model tier, token cap). The UI reads it too.
- `lib/llm/` hides the model provider behind `LlmClient`. Only `litellm.ts` imports the OpenAI SDK.
- `lib/tools/` is plain code with no model calls: GitHub, Gherkin parsing, coverage, exporters.
- `lib/core/` has shared types, zod schemas, errors and JSON helpers. `types.ts` has no runtime imports and is safe in client components.
- `components/` is the browser UI. `useRun.ts` reads the NDJSON stream and reduces events to state.

## Conventions

- Follow SOLID: one job per module, depend on the interfaces (`LlmClient`, `GitHubClient`, `RateLimiter`), add behaviour by adding a file rather than editing the orchestrator's internals.
- Ids (`AC-1`, `EC-1`, `S1`) are assigned by code, never by a model.
- Anything a model cites (a quote, an issue number, a criterion id) must be checked in code before it is shown.
- Text from a user or from GitHub goes into a prompt only through `untrusted()`.
- Model output is rendered as text. Never use `dangerouslySetInnerHTML`.
- Errors shown to a visitor must be `UserFacingError`. Anything else is replaced with a generic message.
- Server-only modules (`lib/config.ts`, `lib/llm/`, `lib/tools/github.ts`) must not be imported from a client component.
- New behaviour needs a test in `tests/`. Pipeline behaviour is tested through `runPipeline` with a scripted model, not by mocking internals.
- UI copy: plain sentences, no jargon. Pixel fonts for headings and short labels only.
