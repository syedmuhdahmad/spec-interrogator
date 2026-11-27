"use client";

import { AGENTS, agentName, agentSpec } from "@/lib/agents/registry";
import type { AgentId } from "@/lib/core/types";
import type { TimelineRow } from "./useRun";

const STATUS_STYLE = {
  running: { dot: "bg-yellow blink", text: "text-yellow", label: "Working" },
  done: { dot: "bg-green", text: "text-green", label: "Done" },
  error: { dot: "bg-red", text: "text-red", label: "Failed" },
  skipped: { dot: "bg-line-2", text: "text-muted", label: "Skipped" },
} as const;

function seconds(ms: number | undefined): string | null {
  if (ms === undefined) return null;
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** The latest status of each agent, for the roster strip. */
function latestStatus(rows: TimelineRow[]): Map<AgentId, keyof typeof STATUS_STYLE> {
  const map = new Map<AgentId, keyof typeof STATUS_STYLE>();
  for (const row of rows) if (row.kind === "agent") map.set(row.agent, row.status);
  return map;
}

export function Roster({ rows }: { rows: TimelineRow[] }) {
  const status = latestStatus(rows);
  return (
    <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-11" aria-label="Agent roster">
      {AGENTS.map((agent) => {
        const state = status.get(agent.id);
        const style = state ? STATUS_STYLE[state] : null;
        return (
          <li
            key={agent.id}
            className={`panel flex flex-col items-center gap-2 px-1 py-2 text-center ${state === "running" ? "border-yellow" : ""}`}
            title={`${agent.name}: ${style?.label ?? "Waiting"}`}
          >
            <span className={`pixel-dot ${style?.dot ?? ""}`} aria-hidden />
            <span className={`lbl !text-[0.62rem] !tracking-[0.06em] ${state ? "text-ink" : "text-muted"}`}>
              {agent.short}
            </span>
            <span className="sr-only">{style?.label ?? "Waiting"}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function Timeline({ rows, running }: { rows: TimelineRow[]; running: boolean }) {
  if (rows.length === 0) {
    return <p className="p-4 text-muted">{running ? "Starting the agents…" : "The agents' steps will appear here."}</p>;
  }

  return (
    <ol className="flex flex-col" aria-label="Agent timeline" aria-live="polite" aria-relevant="additions">
      {rows.map((row) =>
        row.kind === "loop" ? (
          <li key={row.key} className="rise border-l-4 border-blue bg-blue/10 px-4 py-3">
            <p className="lbl text-blue">
              ↺ Loop {row.round}/{row.max}: {agentName(row.from)} → {agentName(row.to)}
            </p>
            <p className="mt-1 text-sm text-ink">{row.reason}</p>
          </li>
        ) : (
          <li key={row.key} className="rise border-b border-line px-4 py-3 last:border-b-0">
            <div className="flex items-start gap-3">
              <span className={`pixel-dot mt-1.5 ${STATUS_STYLE[row.status].dot}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-semibold">
                    {agentName(row.agent)}
                    {row.round && row.round > 1 ? <span className="text-muted"> · round {row.round}</span> : null}
                  </span>
                  <span className={`lbl !text-[0.65rem] ${STATUS_STYLE[row.status].text}`}>{STATUS_STYLE[row.status].label}</span>
                  <span className="lbl !text-[0.65rem] text-muted">
                    {agentSpec(row.agent).kind === "code" ? "code" : (row.model ?? "llm")}
                    {seconds(row.ms) ? ` · ${seconds(row.ms)}` : ""}
                    {row.tokens ? ` · ${row.tokens.toLocaleString("en-US")} tok` : ""}
                  </span>
                </div>
                {row.message ? <p className="mt-1 text-sm text-muted">{row.message}</p> : null}
                {row.tools.length > 0 ? (
                  <ul className="mt-2 flex flex-col gap-1">
                    {row.tools.map((tool, index) => (
                      <li key={`${tool.tool}-${index}`} className="code flex gap-2 border-l-2 border-line-2 pl-3 !text-[0.78rem]">
                        <span className={tool.ok ? "text-green" : "text-red"} aria-hidden>
                          {tool.ok ? "✓" : "✗"}
                        </span>
                        <span className="min-w-0 break-words">
                          <span className="text-yellow">{tool.tool}</span>
                          <span className="sr-only">{tool.ok ? " succeeded: " : " failed: "}</span>
                          <span className="text-muted"> {tool.message}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          </li>
        ),
      )}
    </ol>
  );
}
