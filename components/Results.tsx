"use client";

import { useId, useState } from "react";
import type { Artifacts, ExportFile, RunEvent, Severity } from "@/lib/core/types";

type TabId = "questions" | "criteria" | "feature" | "plan" | "exports" | "log";

const SEVERITY_STYLE: Record<Severity, string> = {
  high: "text-red",
  medium: "text-yellow",
  low: "text-blue",
};

const PRIORITY_STYLE: Record<string, string> = { P1: "text-red", P2: "text-yellow", P3: "text-blue" };

function Waiting({ what }: { what: string }) {
  return <p className="p-5 text-muted">{what} will appear here once the agents get to it.</p>;
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

function download(file: ExportFile) {
  const url = URL.createObjectURL(new Blob([file.content], { type: `${file.mime};charset=utf-8` }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function CodeBlock({ text, numbered = false }: { text: string; numbered?: boolean }) {
  const lines = text.replace(/\n$/, "").split("\n");
  return (
    <pre className="code scroll-thin max-h-[34rem] overflow-auto bg-bg p-4" tabIndex={0}>
      {numbered
        ? lines.map((line, index) => (
            <div key={index} className="flex">
              <span className="mr-4 w-8 flex-none select-none text-right text-line-2" aria-hidden>
                {index + 1}
              </span>
              <span className={`whitespace-pre-wrap break-words ${lineClass(line)}`}>{line || " "}</span>
            </div>
          ))
        : text}
    </pre>
  );
}

/** Light Gherkin colouring: tags, keywords and section headers. */
function lineClass(line: string): string {
  const trimmed = line.trim();
  if (trimmed.startsWith("@")) return "text-blue";
  if (/^(Feature|Rule|Background|Scenario Outline|Scenario Template|Scenario|Example|Examples):/.test(trimmed)) return "text-yellow";
  if (trimmed.startsWith("#")) return "text-muted";
  if (trimmed.startsWith("|")) return "text-green";
  return "text-ink";
}

function questionsAsText(artifacts: Partial<Artifacts>): string {
  const items = artifacts.ambiguities ?? [];
  const title = artifacts.story?.title ?? "the requirement";
  return [
    `Questions about "${title}":`,
    "",
    ...items.map((item, index) => `${index + 1}. ${item.question}${item.quote ? `\n   (Re: "${item.quote}")` : ""}`),
  ].join("\n");
}

export function Results({ artifacts, events }: { artifacts: Partial<Artifacts>; events: RunEvent[] }) {
  const [tab, setTab] = useState<TabId>("questions");
  const [previewName, setPreviewName] = useState<string | null>(null);
  const baseId = useId();

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: "questions", label: "Questions", count: artifacts.ambiguities?.length },
    { id: "criteria", label: "Criteria", count: artifacts.criteria?.length },
    { id: "feature", label: "Feature", count: artifacts.validation?.stats.scenarios },
    { id: "plan", label: "Test plan", count: artifacts.ranking?.length },
    { id: "exports", label: "Exports", count: artifacts.exports?.length },
    { id: "log", label: "Log", count: events.length || undefined },
  ];

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const index = tabs.findIndex((item) => item.id === tab);
    const next = tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    setTab(next.id);
    document.getElementById(`${baseId}-tab-${next.id}`)?.focus();
  };

  return (
    <div className="panel flex min-w-0 flex-col">
      <div role="tablist" aria-label="Results" className="scroll-thin flex overflow-x-auto border-b-2 border-line" onKeyDown={onKeyDown}>
        {tabs.map((item) => (
          <button
            key={item.id}
            id={`${baseId}-tab-${item.id}`}
            role="tab"
            type="button"
            aria-selected={tab === item.id}
            aria-controls={`${baseId}-panel`}
            tabIndex={tab === item.id ? 0 : -1}
            className="tab"
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.count !== undefined ? <span className="ml-2 text-yellow">{String(item.count).padStart(2, "0")}</span> : null}
          </button>
        ))}
      </div>

      <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${tab}`} className="min-w-0">
        {tab === "questions" && <QuestionsTab artifacts={artifacts} />}
        {tab === "criteria" && <CriteriaTab artifacts={artifacts} />}
        {tab === "feature" && <FeatureTab artifacts={artifacts} />}
        {tab === "plan" && <PlanTab artifacts={artifacts} />}
        {tab === "exports" && <ExportsTab files={artifacts.exports} previewName={previewName} onPreview={setPreviewName} />}
        {tab === "log" && <LogTab events={events} />}
      </div>
    </div>
  );
}

function QuestionsTab({ artifacts }: { artifacts: Partial<Artifacts> }) {
  const items = artifacts.ambiguities;
  if (!items) return <Waiting what="Questions for the client" />;
  if (items.length === 0) return <p className="p-5 text-muted">The Ambiguity Hunter found nothing worth asking the client about.</p>;

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <p className="text-sm text-muted">Ask these before the sprint starts. Each one quotes the words it is about.</p>
        <CopyButton text={questionsAsText(artifacts)} label="Copy as message" />
      </div>
      <ol className="flex flex-col">
        {items.map((item, index) => (
          <li key={index} className="border-b border-line px-5 py-4 last:border-b-0">
            <div className="flex flex-wrap items-center gap-3">
              <span className={`chip ${SEVERITY_STYLE[item.severity]}`}>{item.severity}</span>
              <span className="lbl text-muted">{item.term}</span>
            </div>
            <p className="mt-2 text-lg font-semibold leading-snug">{item.question}</p>
            {item.quote ? (
              <blockquote className="mt-2 border-l-4 border-line-2 pl-3 text-muted">
                “{item.quote}”
                {!item.quoteVerified ? (
                  <span className="lbl ml-2 text-yellow" title="A code check could not find these exact words in the requirement.">
                    quote not found verbatim
                  </span>
                ) : null}
              </blockquote>
            ) : null}
            <p className="mt-2 text-sm text-muted">
              <span className="text-ink">Why it matters:</span> {item.whyItMatters}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function CriteriaTab({ artifacts }: { artifacts: Partial<Artifacts> }) {
  const { criteria, edgeCases, plan } = artifacts;
  if (!criteria) return <Waiting what="Acceptance criteria and edge cases" />;

  return (
    <div className="flex flex-col gap-6 p-5">
      {plan ? (
        <p className="text-sm text-muted">
          <span className="chip mr-2 text-ink">{plan.domain}</span>
          <span className={`chip mr-2 ${SEVERITY_STYLE[plan.riskLevel]}`}>{plan.riskLevel} risk</span>
          {plan.summary}
        </p>
      ) : null}

      <section>
        <h3 className="lbl mb-2 text-yellow">Acceptance criteria</h3>
        <ul className="flex flex-col gap-3">
          {criteria.map((criterion) => (
            <li key={criterion.id} className="flex gap-3">
              <span className="chip h-fit text-green">{criterion.id}</span>
              <div className="min-w-0">
                <p>{criterion.text}</p>
                {criterion.sourceQuote ? (
                  <p className="mt-1 text-sm text-muted">
                    From: “{criterion.sourceQuote}”
                    {!criterion.quoteVerified ? <span className="lbl ml-2 text-yellow">quote not found verbatim</span> : null}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="lbl mb-2 text-yellow">Edge cases</h3>
        {!edgeCases ? (
          <p className="text-muted">The Edge-Case Explorer is still working.</p>
        ) : edgeCases.length === 0 ? (
          <p className="text-muted">No edge cases were produced.</p>
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="lbl text-muted">
                <tr>
                  <th className="py-2 pr-3 font-normal">ID</th>
                  <th className="py-2 pr-3 font-normal">Risk</th>
                  <th className="py-2 pr-3 font-normal">Case</th>
                  <th className="py-2 pr-3 font-normal">Expected</th>
                  <th className="py-2 font-normal">For</th>
                </tr>
              </thead>
              <tbody>
                {edgeCases.map((edgeCase) => (
                  <tr key={edgeCase.id} className="border-t border-line align-top">
                    <td className="py-2 pr-3 font-mono text-blue">{edgeCase.id}</td>
                    <td className={`py-2 pr-3 ${SEVERITY_STYLE[edgeCase.severity]}`}>{edgeCase.severity}</td>
                    <td className="py-2 pr-3">
                      {edgeCase.title}
                      <span className="block text-muted">{edgeCase.category}</span>
                    </td>
                    <td className="py-2 pr-3 text-muted">{edgeCase.expected}</td>
                    <td className="py-2 font-mono text-green">{edgeCase.relatedAC}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function FeatureTab({ artifacts }: { artifacts: Partial<Artifacts> }) {
  const { feature, validation } = artifacts;
  if (!feature) return <Waiting what="The Gherkin feature file" />;

  const problems = validation
    ? [
        ...validation.parseErrors.map((error) => `Line ${error.line}: ${error.message}`),
        ...validation.uncoveredACs.map((id) => `${id} has no scenario.`),
        ...validation.uncoveredECs.map((id) => `High-risk edge case ${id} has no scenario.`),
        ...validation.stepIssues.map((issue) => `${issue.scenario}: ${issue.problem}`),
      ]
    : [];

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        {validation ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className={`chip ${validation.ok ? "text-green" : "text-red"}`}>{validation.ok ? "Checks passed" : "Checks failed"}</span>
            <span className="chip text-ink">
              AC {validation.stats.acCovered}/{validation.stats.acTotal}
            </span>
            <span className="chip text-ink">
              EC {validation.stats.ecCovered}/{validation.stats.ecTotal}
            </span>
            <span className="chip text-muted">{validation.stats.steps} steps</span>
          </div>
        ) : (
          <span className="text-muted">Checking…</span>
        )}
        <CopyButton text={feature} />
      </div>
      {problems.length > 0 ? (
        <ul className="border-b border-line bg-red/10 px-5 py-3 text-sm">
          {problems.slice(0, 8).map((problem, index) => (
            <li key={index} className="flex gap-2">
              <span className="text-red" aria-hidden>
                ✗
              </span>
              {problem}
            </li>
          ))}
        </ul>
      ) : null}
      <CodeBlock text={feature} numbered />
    </div>
  );
}

function PlanTab({ artifacts }: { artifacts: Partial<Artifacts> }) {
  const { ranking, history, review } = artifacts;
  if (!ranking && !history && !review) return <Waiting what="The test plan, ranked by risk" />;

  return (
    <div className="flex flex-col gap-6 p-5">
      {ranking && ranking.length > 0 ? (
        <section>
          <h3 className="lbl mb-2 text-yellow">Run order by risk</h3>
          <ol className="flex flex-col">
            {ranking.map((item) => (
              <li key={item.id} className="flex gap-3 border-t border-line py-3 first:border-t-0">
                <span className={`chip h-fit ${PRIORITY_STYLE[item.priority]}`}>{item.priority}</span>
                <div className="min-w-0">
                  <p className="font-semibold">{item.scenario}</p>
                  <p className="text-sm text-muted">{item.reason}</p>
                  <p className="code mt-1 !text-[0.75rem] text-blue">{item.tags.filter((tag) => /^@(AC|EC)-/i.test(tag)).join(" ")}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {review ? (
        <section>
          <h3 className="lbl mb-2 text-yellow">
            Skeptic&apos;s review
            {review.addressed ? <span className="chip ml-3 text-green">Addressed in the revision</span> : null}
          </h3>
          {review.issues.length === 0 ? (
            <p className="text-muted">No problems raised.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {review.issues.map((issue, index) => (
                <li key={index}>
                  <span className={`chip mr-2 ${issue.severity === "major" ? "text-red" : "text-muted"}`}>{issue.severity}</span>
                  <span className="font-semibold">{issue.scenario}:</span> {issue.problem} <span className="text-muted">Fix: {issue.fix}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {history ? (
        <section>
          <h3 className="lbl mb-2 text-yellow">Lessons from past bugs in {history.repo}</h3>
          <p className="text-sm text-muted">{history.summary}</p>
          {history.lessons.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-2 text-sm">
              {history.lessons.map((lesson, index) => (
                <li key={index}>
                  {lesson.lesson}{" "}
                  {lesson.issues.map((number) => {
                    const match = history.matches.find((issue) => issue.number === number);
                    return match ? (
                      <a key={number} href={match.url} target="_blank" rel="noopener noreferrer" className="mr-2 text-blue underline" title={match.title}>
                        #{number}
                      </a>
                    ) : null;
                  })}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function ExportsTab({
  files,
  previewName,
  onPreview,
}: {
  files: ExportFile[] | undefined;
  previewName: string | null;
  onPreview: (name: string) => void;
}) {
  if (!files) return <Waiting what="The downloadable files" />;
  const preview = files.find((file) => file.name === previewName) ?? files[0];

  return (
    <div className="flex flex-col">
      <ul className="grid gap-3 border-b border-line p-5 sm:grid-cols-2">
        {files.map((file) => (
          <li key={file.name} className={`flex flex-col gap-2 border-2 p-3 ${preview?.name === file.name ? "border-yellow" : "border-line"}`}>
            <span className="lbl text-yellow">{file.label}</span>
            <span className="code break-all !text-[0.78rem] text-muted">{file.name}</span>
            <div className="mt-1 flex flex-wrap gap-2">
              <button type="button" className="btn btn-sm" onClick={() => download(file)}>
                Download
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPreview(file.name)} aria-pressed={preview?.name === file.name}>
                Preview
              </button>
            </div>
          </li>
        ))}
      </ul>
      {preview ? <CodeBlock text={preview.content} /> : null}
    </div>
  );
}

function LogTab({ events }: { events: RunEvent[] }) {
  if (events.length === 0) return <Waiting what="The raw event log" />;
  const lines = events.map((event) => {
    const time = `${(event.t / 1000).toFixed(1).padStart(6, " ")}s`;
    switch (event.type) {
      case "agent":
        return `${time}  ${event.agent.padEnd(10)} ${event.status}${event.round ? ` r${event.round}` : ""}${
          event.tokensIn || event.tokensOut ? `  [${event.tokensIn ?? 0} in, ${event.tokensOut ?? 0} out]` : ""
        }${event.message ? `  ${event.message}` : ""}`;
      case "tool":
        return `${time}  ${event.agent.padEnd(10)} tool ${event.tool} ${event.ok ? "ok" : "FAILED"}  ${event.message}`;
      case "loop":
        return `${time}  LOOP ${event.round}/${event.max} ${event.from} -> ${event.to}  ${event.reason}`;
      case "artifact":
        return `${time}  artifact   ${event.key}`;
      case "run_start":
        return `${time}  run start  mode=${event.mode} source=${event.source}`;
      case "run_done":
        return `${time}  run done   ${event.llmCalls} model calls, ${event.tokensIn + event.tokensOut} tokens`;
      case "run_error":
        return `${time}  run error  ${event.message}`;
      default:
        return `${time}  ${event.type}`;
    }
  });
  return <CodeBlock text={lines.join("\n")} />;
}
