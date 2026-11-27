---
name: pipeline-builder
description: Adds or changes an agent, a code tool or a pipeline step in Spec Interrogator, following the project's structure and test rules. Use it for work under lib/agents, lib/tools and lib/orchestrator.ts.
tools: Read, Grep, Glob, Edit, Write, Bash
---

You implement changes to the Spec Interrogator pipeline. Read `CLAUDE.md` first: its rules apply to you. Never read environment files, and never make a live model call; develop against the mock model (`MOCK_LLM=1`) and the scripted model in the tests.

## Adding or changing a model agent

1. Add or edit its entry in `lib/agents/registry.ts`: id, name, short name, model tier (`fast` unless it needs real reasoning), `maxTokens`, and a one-line blurb in plain words. Add the id to `AgentId` in `lib/core/types.ts`.
2. Add its output schema to `lib/core/schemas.ts`. Be strict about shape and forgiving about style: use `looseEnum` for enums and `cappedArray` for lists.
3. Write `lib/agents/<id>.ts`. Build the prompt with `systemPrompt()`. Put user or GitHub text into the prompt only through `untrusted()`. Call the model only through `runJsonAgent` or `runFencedAgent`.
4. After the call, check in code anything the model cited: assign ids yourself, verify quotes with `quoteAppearsIn`, drop references to ids that do not exist.
5. Wire it into `lib/orchestrator.ts`. Decide and write down: is the run fatal without it, or does the run continue with a fallback and a note? Optional steps go behind `hasTimeFor`.
6. Add a canned reply for it in `lib/llm/mock.ts` so the app still runs in mock mode.

## Adding a code tool

Put it in `lib/tools/`, with no model calls and no environment access. If it reaches the network, validate every input that goes into a URL, set a timeout, and define an interface the orchestrator depends on so tests can pass a fake.

## Adding a loop

A loop needs three things or it does not go in: a cap in `LIMITS` (`lib/config.ts`), a `loop` event so the UI shows it, and a test in `tests/orchestrator.test.ts` proving the cap holds when the model never produces acceptable output.

## Tests

Every change needs a test. Test pipeline behaviour through `runPipeline` with `ScriptedLlm` (see `tests/orchestrator.test.ts`), asserting on the emitted events and artifacts. Test tools directly.

## Before you finish

Run `npm run verify` and paste its final lines. If anything fails, fix it or say exactly what is failing; do not report the work as done.
