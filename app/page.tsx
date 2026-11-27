import { INSPECTOR_PALETTE, INSPECTOR_ROWS, PixelIcon } from "@/components/PixelIcon";
import { Workbench } from "@/components/Workbench";
import { AGENTS } from "@/lib/agents/registry";
import { LIMITS } from "@/lib/config";

const REPO_URL = "https://github.com/syedmuhdahmad/spec-interrogator";

const OUTPUTS = [
  { name: "Client questions", detail: "Every vague or missing requirement, as a question you can send today." },
  { name: "Validated .feature file", detail: "Gherkin that parses, with every criterion traced to a scenario." },
  { name: "Test plan ranked by risk", detail: "What to run first when there is no time to run everything." },
  { name: "Playwright stubs + Jira CSV", detail: "One stub per scenario, and tickets ready to import." },
] as const;

const SAFEGUARDS = [
  `Loops are capped: ${LIMITS.maxFixRounds} fix rounds, ${LIMITS.maxReviseRounds} revision, ${LIMITS.maxHistorySearches} searches.`,
  `Each run stops at ${LIMITS.maxRunTokens.toLocaleString("en-US")} tokens or ${Math.round(LIMITS.runHardStopMs / 1000)} seconds.`,
  "The API key lives only in the server environment. The browser never sees it.",
  "Pasted text is treated as data: agents are told never to follow instructions inside it.",
  "Quotes and issue numbers cited by agents are checked in code and flagged if not found.",
  "Nothing you paste is stored. There is no database.",
] as const;

export default function Home() {
  return (
    <>
      <header className="sticky top-0 z-40 border-b-2 border-line bg-bg/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <a href="#top" className="flex items-center gap-3">
            <PixelIcon rows={INSPECTOR_ROWS} palette={INSPECTOR_PALETTE} size={28} />
            <span className="px text-[0.7rem] sm:text-xs">Spec Interrogator</span>
          </a>
          <nav aria-label="Sections" className="flex items-center gap-4 sm:gap-6">
            <a href="#how" className="lbl hidden text-muted hover:text-ink sm:inline">
              How it works
            </a>
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="lbl hidden text-muted hover:text-ink sm:inline">
              Source
            </a>
            <a href="#workbench" className="btn btn-sm">
              ▶ Start
            </a>
          </nav>
        </div>
      </header>

      <main id="top">
        <section className="mx-auto flex max-w-6xl flex-col items-center px-4 pb-10 pt-14 text-center sm:px-6 sm:pt-20">
          <p className="lbl text-muted">Agent-A-Thon 2026 entry · QA</p>
          <PixelIcon rows={INSPECTOR_ROWS} palette={INSPECTOR_PALETTE} size={84} className="mt-6" />
          <h1 className="px-title mt-6 text-2xl sm:text-4xl lg:text-5xl">
            Interrogate
            <br />
            the spec
          </h1>
          <p className="lbl mt-8 text-ink">
            One story in. <span className="text-red">Eight agents. Zero vague requirements.</span>
          </p>
          <p className="mt-5 max-w-2xl text-lg text-muted">
            Paste a user story or a public GitHub issue. A team of AI agents finds what the requirement leaves unsaid, writes a Gherkin test suite, checks
            it with real code, argues with itself about the result, and hands you a <strong className="text-ink">test plan before the sprint starts</strong>.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <a href="#workbench" className="btn">
              ▶ Open a case
            </a>
            <a href="#how" className="btn btn-ghost">
              How it works
            </a>
          </div>

          <ul className="mt-12 grid w-full gap-px border-2 border-line bg-line text-left sm:grid-cols-2 lg:grid-cols-4">
            {OUTPUTS.map((output) => (
              <li key={output.name} className="bg-panel p-4">
                <p className="lbl text-yellow">{output.name}</p>
                <p className="mt-2 text-sm text-muted">{output.detail}</p>
              </li>
            ))}
          </ul>
        </section>

        <div className="border-t-2 border-line">
          <Workbench />
        </div>

        <section id="how" className="border-t-2 border-line" aria-labelledby="how-title">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <p className="lbl text-red">Level map</p>
            <h2 id="how-title" className="px mt-3 text-xl sm:text-2xl">
              How it works
            </h2>
            <p className="mt-3 max-w-3xl text-muted">
              Eight agents call a model. Three steps are plain code, because parsing and coverage are facts to compute, not opinions to ask for. Two
              feedback loops let the steps check each other: the Validator sends broken or incomplete Gherkin back to the Test Designer, and the Skeptic
              can send the suite back once.
            </p>

            <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {AGENTS.map((agent, index) => (
                <li key={agent.id} className="panel flex gap-4 p-4">
                  <span className="px text-sm text-line-2" aria-hidden>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{agent.name}</h3>
                      <span className={`chip !text-[0.6rem] ${agent.kind === "code" ? "text-green" : agent.tier === "fast" ? "text-blue" : "text-yellow"}`}>
                        {agent.kind === "code" ? "code" : agent.tier === "fast" ? "fast model" : "main model"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted">{agent.blurb}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-10 grid gap-6 lg:grid-cols-2">
              <div className="panel p-5">
                <h3 className="lbl text-yellow">Guardrails</h3>
                <ul className="mt-3 flex flex-col gap-2 text-sm text-muted">
                  {SAFEGUARDS.map((line) => (
                    <li key={line} className="flex gap-2">
                      <span className="text-green" aria-hidden>
                        ■
                      </span>
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="panel p-5">
                <h3 className="lbl text-yellow">Who it is for</h3>
                <p className="mt-3 text-sm text-muted">
                  QA engineers, business analysts and project managers at sprint grooming. An ambiguity caught here costs one message to the client. The
                  same ambiguity caught in UAT costs a change request.
                </p>
                <p className="mt-3 text-sm text-muted">
                  The output is a draft for a QA engineer to review, not a replacement for one. Agents can be wrong, which is why the checks that can be
                  done in code are done in code.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t-2 border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted sm:px-6">
          <p>Built by Syed Muhammad Ahmad for the SSI Agent-A-Thon 2026. Sample requirements are made up.</p>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="lbl hover:text-ink">
            Source on GitHub
          </a>
        </div>
      </footer>
    </>
  );
}
