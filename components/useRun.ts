"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import type { AgentId, Artifacts, RunEvent, RunMode } from "@/lib/core/types";

export interface ToolRow {
  tool: string;
  ok: boolean;
  message: string;
}

export type TimelineRow =
  | {
      kind: "agent";
      key: string;
      agent: AgentId;
      round?: number;
      status: "running" | "done" | "error" | "skipped";
      message?: string;
      model?: string;
      ms?: number;
      tokens?: number;
      tools: ToolRow[];
    }
  | { kind: "loop"; key: string; from: AgentId; to: AgentId; round: number; max: number; reason: string };

export interface RunSummary {
  ms: number;
  llmCalls: number;
  tokensIn: number;
  tokensOut: number;
  estCostUsd: number;
  partial: boolean;
  note?: string;
}

export interface RunState {
  phase: "idle" | "running" | "done" | "error";
  mode?: RunMode;
  title?: string;
  rows: TimelineRow[];
  artifacts: Partial<Artifacts>;
  summary?: RunSummary;
  error?: string;
  startedAt?: number;
  events: RunEvent[];
}

type Action =
  | { type: "begin"; mode?: RunMode; startedAt: number }
  | { type: "event"; event: RunEvent; recorded: boolean }
  | { type: "fail"; message: string }
  | { type: "reset" };

const INITIAL: RunState = { phase: "idle", rows: [], artifacts: {}, events: [] };

function lastAgentRowIndex(rows: TimelineRow[], agent: AgentId): number {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row.kind === "agent" && row.agent === agent) return index;
  }
  return -1;
}

function reduce(state: RunState, action: Action): RunState {
  switch (action.type) {
    case "reset":
      return INITIAL;
    case "begin":
      return { ...INITIAL, phase: "running", mode: action.mode, startedAt: action.startedAt };
    case "fail":
      return { ...state, phase: "error", error: action.message, rows: settleRunning(state.rows) };
    case "event":
      return applyEvent(state, action.event, action.recorded);
  }
}

/** When a run ends abruptly, nothing should be left showing as "running". */
function settleRunning(rows: TimelineRow[]): TimelineRow[] {
  return rows.map((row) => (row.kind === "agent" && row.status === "running" ? { ...row, status: "error", message: row.message ?? "Stopped." } : row));
}

function applyEvent(state: RunState, event: RunEvent, recorded: boolean): RunState {
  const events = event.type === "ping" ? state.events : [...state.events, event];
  const key = `${event.t}-${state.events.length}`;

  switch (event.type) {
    case "ping":
      return state;

    case "run_start":
      return { ...state, events, mode: recorded ? "recorded" : event.mode, title: event.title };

    case "agent": {
      const rows = [...state.rows];
      if (event.status === "start" || event.status === "skipped") {
        rows.push({
          kind: "agent",
          key,
          agent: event.agent,
          round: event.round,
          status: event.status === "start" ? "running" : "skipped",
          message: event.message,
          model: event.model,
          tools: [],
        });
        return { ...state, events, rows };
      }
      const index = lastAgentRowIndex(rows, event.agent);
      const tokens = (event.tokensIn ?? 0) + (event.tokensOut ?? 0);
      const patch = {
        status: event.status,
        message: event.message,
        ms: event.ms,
        tokens: tokens || undefined,
        model: event.model,
      } as const;
      if (index === -1) {
        rows.push({ kind: "agent", key, agent: event.agent, round: event.round, tools: [], ...patch });
      } else {
        const row = rows[index];
        if (row.kind === "agent") rows[index] = { ...row, ...patch, model: event.model ?? row.model };
      }
      return { ...state, events, rows };
    }

    case "tool": {
      const rows = [...state.rows];
      const index = lastAgentRowIndex(rows, event.agent);
      const tool: ToolRow = { tool: event.tool, ok: event.ok, message: event.message };
      if (index === -1) {
        rows.push({ kind: "agent", key, agent: event.agent, status: "running", tools: [tool] });
      } else {
        const row = rows[index];
        if (row.kind === "agent") rows[index] = { ...row, tools: [...row.tools, tool] };
      }
      return { ...state, events, rows };
    }

    case "loop":
      return {
        ...state,
        events,
        rows: [...state.rows, { kind: "loop", key, from: event.from, to: event.to, round: event.round, max: event.max, reason: event.reason }],
      };

    case "artifact":
      return { ...state, events, artifacts: { ...state.artifacts, [event.key]: event.data } };

    case "run_done":
      return {
        ...state,
        events,
        phase: "done",
        rows: settleRunning(state.rows),
        summary: {
          ms: event.ms,
          llmCalls: event.llmCalls,
          tokensIn: event.tokensIn,
          tokensOut: event.tokensOut,
          estCostUsd: event.estCostUsd,
          partial: event.partial,
          note: event.note,
        },
      };

    case "run_error":
      return { ...state, events, phase: "error", error: event.message, rows: settleRunning(state.rows) };
  }
}

export type RunRequestBody =
  | { kind: "text"; text: string; title?: string; sampleId?: string }
  | { kind: "github"; url: string; sampleId?: string };

/** Longest pause kept between two events when playing back a recording. */
const REPLAY_MAX_GAP_MS = 900;
const REPLAY_SPEED = 0.3;

/**
 * Owns one run: starts it, reads the event stream, and folds events into the
 * state the UI renders. Also plays back recorded runs.
 */
export function useRun() {
  const [state, dispatch] = useReducer(reduce, INITIAL);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(
    async (body: RunRequestBody) => {
      stop();
      const controller = new AbortController();
      abortRef.current = controller;
      dispatch({ type: "begin", startedAt: Date.now() });

      try {
        const response = await fetch("/api/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          let message = `The server refused the run (${response.status}).`;
          try {
            const payload = (await response.json()) as { error?: string };
            if (payload.error) message = payload.error;
          } catch {
            // Keep the generic message.
          }
          dispatch({ type: "fail", message });
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let finished = false;

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line) as RunEvent;
              if (event.type === "run_done" || event.type === "run_error") finished = true;
              dispatch({ type: "event", event, recorded: false });
            } catch {
              // A malformed line is skipped rather than ending the run.
            }
          }
        }
        if (!finished) dispatch({ type: "fail", message: "The connection closed before the run finished. Results so far are shown." });
      } catch (error) {
        if (controller.signal.aborted) {
          dispatch({ type: "fail", message: "Run stopped. Results so far are shown." });
        } else {
          dispatch({ type: "fail", message: error instanceof Error ? `Network problem: ${error.message}` : "Network problem." });
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [stop],
  );

  const replay = useCallback(
    async (sampleId: string) => {
      stop();
      const controller = new AbortController();
      abortRef.current = controller;
      dispatch({ type: "begin", mode: "recorded", startedAt: Date.now() });

      try {
        const response = await fetch(`/replays/${encodeURIComponent(sampleId)}.json`, { signal: controller.signal });
        if (!response.ok) {
          dispatch({ type: "fail", message: "There is no recording for this sample yet." });
          return;
        }
        const events = (await response.json()) as RunEvent[];
        let previous = 0;
        for (const event of events) {
          const gap = Math.min(Math.max(event.t - previous, 0), REPLAY_MAX_GAP_MS) * REPLAY_SPEED;
          previous = event.t;
          if (gap > 0) await new Promise((resolve) => setTimeout(resolve, gap));
          if (controller.signal.aborted) {
            dispatch({ type: "fail", message: "Playback stopped." });
            return;
          }
          dispatch({ type: "event", event, recorded: true });
        }
      } catch {
        if (!controller.signal.aborted) dispatch({ type: "fail", message: "The recording could not be loaded." });
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [stop],
  );

  const reset = useCallback(() => {
    stop();
    dispatch({ type: "reset" });
  }, [stop]);

  return { state, start, replay, stop, reset };
}
