"use client";

import { useEffect, useRef, useState } from "react";
import type { AppStatus } from "@/app/api/status/route";
import { SAMPLES, type Sample } from "@/lib/samples";
import { Results } from "./Results";
import { Roster, Timeline } from "./Timeline";
import { useRun, type RunState } from "./useRun";

const MIN_CHARS = 40;
const FALLBACK_MAX_CHARS = 8000;

const MODE_NOTICE: Record<Exclude<AppStatus["mode"], "live">, { tone: string; text: string }> = {
  mock: {
    tone: "border-yellow text-yellow",
    text: "Mock model: the server is using canned replies for local development. This is not a real analysis.",
  },
  replay: {
    tone: "border-blue text-blue",
    text: "Recorded runs only: live runs are paused to protect the demo budget. Pick a sample to watch a recorded run.",
  },
  offline: {
    tone: "border-red text-red",
    text: "Live runs are not set up yet: the server has no LiteLLM settings. Add them in Vercel and redeploy.",
  },
};

function useElapsed(startedAt: number | undefined, running: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running || !startedAt) return;
    const tick = () => setElapsed(Date.now() - startedAt);
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [startedAt, running]);
  return elapsed;
}

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function Workbench() {
  const { state, start, replay, stop, reset } = useRun();
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [source, setSource] = useState<"text" | "github">("text");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const runRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/status")
      .then((response) => (response.ok ? (response.json() as Promise<AppStatus>) : null))
      .then((value) => {
        if (!cancelled) setStatus(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const running = state.phase === "running";
  const maxChars = status?.maxInputChars ?? FALLBACK_MAX_CHARS;
  const replayOnly = status?.mode === "replay";
  const offline = status?.mode === "offline";

  const scrollToRun = () => requestAnimationFrame(() => runRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));

  const runSample = (sample: Sample) => {
    if (sample.input.kind === "github") {
      setSource("github");
      setUrl(sample.input.url);
    } else {
      setSource("text");
      setText(sample.input.text);
    }
    if (replayOnly) void replay(sample.id);
    else void start({ ...sample.input, sampleId: sample.id });
    scrollToRun();
  };

  const trimmed = text.trim();
  const textProblem =
    trimmed.length === 0
      ? null
      : trimmed.length < MIN_CHARS
        ? `Add a little more detail: at least ${MIN_CHARS} characters.`
        : trimmed.length > maxChars
          ? `Too long by ${(trimmed.length - maxChars).toLocaleString("en-US")} characters.`
          : null;
  const urlLooksRight = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+/.test(url.trim());
  const canSubmit =
    !running && !replayOnly && !offline && (source === "text" ? trimmed.length >= MIN_CHARS && trimmed.length <= maxChars : urlLooksRight);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    void start(source === "text" ? { kind: "text", text: trimmed } : { kind: "github", url: url.trim() });
    scrollToRun();
  };

  return (
    <section id="workbench" className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6" aria-labelledby="workbench-title">
      <p className="lbl text-red">Level 1 · Open a case</p>
      <h2 id="workbench-title" className="px mt-3 text-xl sm:text-2xl">
        Pick a case file
      </h2>
      <p className="mt-3 max-w-2xl text-muted">
        One click runs the whole pipeline on a made-up requirement with ambiguities planted in it. Or bring your own below. Use public or made-up text
        only: do not paste client or company data.
      </p>

      {status && status.mode !== "live" ? (
        <p role="status" className={`lbl mt-5 border-2 bg-panel px-4 py-3 !normal-case !tracking-normal ${MODE_NOTICE[status.mode].tone}`}>
          {MODE_NOTICE[status.mode].text}
        </p>
      ) : null}

      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {SAMPLES.map((sample) => (
          <li key={sample.id}>
            <button
              type="button"
              onClick={() => runSample(sample)}
              disabled={running || offline}
              className="panel group flex h-full w-full flex-col gap-3 p-4 text-left transition-colors hover:border-yellow disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="lbl text-yellow">{sample.level}</span>
              <span className="px text-[0.8rem] leading-relaxed">{sample.title}</span>
              <span className="text-sm text-muted">{sample.teaser}</span>
              <span className="lbl mt-auto pt-2 text-red group-hover:text-ink">▶ {replayOnly ? "Watch recording" : "Run this case"}</span>
            </button>
          </li>
        ))}
      </ul>

      <form onSubmit={submit} className="panel mt-8 p-4 sm:p-6" aria-label="Your own requirement">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="lbl text-yellow">Or bring your own</h3>
          <div role="radiogroup" aria-label="Input type" className="flex">
            {(["text", "github"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={source === kind}
                onClick={() => setSource(kind)}
                className={`lbl border-2 px-3 py-2 ${source === kind ? "border-ink bg-ink text-bg" : "border-line-2 text-muted hover:text-ink"}`}
              >
                {kind === "text" ? "Paste a story" : "GitHub issue"}
              </button>
            ))}
          </div>
        </div>

        {source === "text" ? (
          <div className="mt-4">
            <label htmlFor="story" className="sr-only">
              User story or requirement
            </label>
            <textarea
              id="story"
              className="field scroll-thin min-h-44 resize-y"
              placeholder="As a customer, I want to … so that …  Add the acceptance notes you were given, exactly as written."
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={maxChars + 2000}
              aria-describedby="story-help"
              spellCheck
            />
            <div id="story-help" className="mt-2 flex flex-wrap justify-between gap-2 text-sm">
              <span className={textProblem ? "text-red" : "text-muted"}>{textProblem ?? "The agents quote your exact words, so paste the requirement as written."}</span>
              <span className={`lbl ${trimmed.length > maxChars ? "text-red" : "text-muted"}`}>
                {trimmed.length.toLocaleString("en-US")} / {maxChars.toLocaleString("en-US")}
              </span>
            </div>
          </div>
        ) : (
          <div className="mt-4">
            <label htmlFor="issue-url" className="sr-only">
              Public GitHub issue link
            </label>
            <input
              id="issue-url"
              type="url"
              inputMode="url"
              className="field"
              placeholder="https://github.com/owner/repo/issues/123"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              maxLength={300}
              aria-describedby="issue-help"
              autoComplete="off"
            />
            <p id="issue-help" className={`mt-2 text-sm ${url && !urlLooksRight ? "text-red" : "text-muted"}`}>
              {url && !urlLooksRight
                ? "Use the form https://github.com/owner/repo/issues/123."
                : "Public repositories only. The History Scout also searches that repo's closed bugs."}
            </p>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-4">
          <button type="submit" className="btn" disabled={!canSubmit}>
            ▶ Start interrogation
          </button>
          {running ? (
            <button type="button" className="btn btn-ghost" onClick={stop}>
              ■ Stop
            </button>
          ) : null}
          <span className="text-sm text-muted">A run takes about a minute and uses a shared demo budget.</span>
        </div>
      </form>

      <div ref={runRef} className="scroll-mt-20">
        {state.phase !== "idle" ? <RunView state={state} onReset={reset} onStop={stop} /> : null}
      </div>
    </section>
  );
}

function RunView({ state, onReset, onStop }: { state: RunState; onReset: () => void; onStop: () => void }) {
  const running = state.phase === "running";
  const elapsed = useElapsed(state.startedAt, running);
  const { artifacts, summary } = state;
  const loops = state.rows.filter((row) => row.kind === "loop").length;
  const validation = artifacts.validation;
  const tokens = summary ? summary.tokensIn + summary.tokensOut : undefined;

  const stats: { label: string; value: string; tone?: string }[] = [
    { label: "Questions", value: artifacts.ambiguities ? String(artifacts.ambiguities.length).padStart(2, "0") : "--" },
    { label: "Scenarios", value: validation ? String(validation.stats.scenarios).padStart(2, "0") : "--" },
    {
      label: "Criteria covered",
      value: validation ? `${validation.stats.acCovered}/${validation.stats.acTotal}` : "--",
      tone: validation ? (validation.stats.acCovered === validation.stats.acTotal ? "text-green" : "text-red") : undefined,
    },
    { label: "Loops", value: String(loops).padStart(2, "0"), tone: loops ? "text-blue" : undefined },
    { label: "Tokens", value: tokens !== undefined ? tokens.toLocaleString("en-US") : "--" },
    { label: "Time", value: clock(summary ? summary.ms : elapsed), tone: running ? "text-yellow" : undefined },
  ];

  const modeChip =
    state.mode === "recorded"
      ? { text: "Recorded run", tone: "text-blue" }
      : state.mode === "mock"
        ? { text: "Mock model", tone: "text-yellow" }
        : state.mode === "live"
          ? { text: "Live run", tone: "text-green" }
          : null;

  return (
    <div className="mt-12" aria-busy={running}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="lbl text-red">Level 2 · Interrogation</p>
          <h2 className="px mt-3 break-words text-lg sm:text-xl">{artifacts.story?.title ?? state.title ?? "Running"}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {modeChip ? <span className={`chip ${modeChip.tone}`}>{modeChip.text}</span> : null}
          {running ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onStop}>
              ■ Stop
            </button>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onReset}>
              New case
            </button>
          )}
        </div>
      </div>

      {state.error ? (
        <p role="alert" className="mt-5 border-2 border-red bg-red/10 px-4 py-3">
          <span className="lbl mr-2 text-red">Game over</span>
          {state.error}
        </p>
      ) : null}
      {summary?.note ? (
        <p role="status" className="mt-5 border-2 border-yellow bg-yellow/10 px-4 py-3 text-sm">
          <span className="lbl mr-2 text-yellow">Heads up</span>
          {summary.note}
        </p>
      ) : null}

      <dl className="mt-6 grid grid-cols-2 gap-px border-2 border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-panel px-4 py-3">
            <dt className="lbl !text-[0.65rem] text-muted">{stat.label}</dt>
            <dd className={`px mt-2 text-base ${stat.tone ?? "text-ink"}`}>{stat.value}</dd>
          </div>
        ))}
      </dl>
      {summary ? (
        <p className="mt-2 text-sm text-muted">
          {summary.llmCalls} model calls. Estimated cost ${summary.estCostUsd.toFixed(3)} (an estimate from assumed token prices, not billing data).
        </p>
      ) : null}

      <div className="mt-6">
        <Roster rows={state.rows} />
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="panel min-w-0">
          <h3 className="lbl border-b-2 border-line px-4 py-3 text-yellow">Agent timeline</h3>
          <div className="scroll-thin max-h-[40rem] overflow-y-auto">
            <Timeline rows={state.rows} running={running} />
          </div>
        </div>
        <Results artifacts={artifacts} events={state.events} />
      </div>
    </div>
  );
}
