import { runAmbiguityHunter } from "@/lib/agents/ambiguity";
import { runAnalyst } from "@/lib/agents/analyst";
import type { AgentContext } from "@/lib/agents/base";
import { runTestDesigner, type DesignBrief, type DesignTask } from "@/lib/agents/designer";
import { runEdgeCaseExplorer } from "@/lib/agents/edgecases";
import { runHistoryScout } from "@/lib/agents/history";
import { fallbackPlan, runPlanner } from "@/lib/agents/planner";
import { fallbackRanking, runRiskRanker } from "@/lib/agents/ranker";
import type { ModelTier } from "@/lib/agents/registry";
import { runSkeptic } from "@/lib/agents/skeptic";
import type { Limits, ModelPrice } from "@/lib/config";
import { AgentOutputError, UserFacingError, toUserMessage } from "@/lib/core/errors";
import type {
  AgentId,
  Ambiguity,
  Criterion,
  EdgeCase,
  Emit,
  HistoryReport,
  Plan,
  RankedScenario,
  Review,
  RunEvent,
  RunInput,
  StoryDoc,
  ValidationReport,
} from "@/lib/core/types";
import type { LlmClient } from "@/lib/llm/types";
import { UsageMeter } from "@/lib/llm/usage";
import { markClarifications } from "@/lib/tools/clarification";
import { checkCoverage, describeValidation } from "@/lib/tools/coverage";
import { buildExports } from "@/lib/tools/exporters";
import { applyPriorityTags, parseGherkin, type ParsedFeature } from "@/lib/tools/gherkin";
import { parseIssueUrl, type GitHubClient } from "@/lib/tools/github";

/** Everything the pipeline needs from outside. Tests pass fakes; the route passes the real ones. */
export interface PipelineDeps {
  llm: LlmClient;
  github: GitHubClient;
  models: Record<ModelTier, string>;
  prices: Record<ModelTier, ModelPrice>;
  limits: Limits;
  now?: () => number;
  runId?: string;
}

interface Draft {
  feature: string;
  parsed: ParsedFeature;
  report: ValidationReport;
}

/**
 * Runs the whole analysis for one requirement and reports progress through
 * `sink`. It never throws: a failure becomes a `run_error` event, and whatever
 * was produced before it has already been sent.
 *
 * Order: Intake -> Planner -> Analyst -> (Ambiguity Hunter | Edge-Case
 * Explorer | History Scout in parallel) -> Test Designer <-> Validator loop
 * -> Skeptic (may send the suite back once) -> Risk Ranker -> Reporter.
 */
export async function runPipeline(
  input: RunInput,
  deps: PipelineDeps,
  sink: (event: RunEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const emit: Emit = (body) => sink({ ...body, t: now() - startedAt } as RunEvent);
  const usage = new UsageMeter(deps.limits.maxRunTokens, deps.prices);
  const context: AgentContext = {
    llm: deps.llm,
    models: deps.models,
    usage,
    emit,
    signal,
    now,
    // A single slow call is cut off in time for the Reporter to still build the files.
    callTimeoutMs: () => deps.limits.runHardStopMs - deps.limits.finishReserveMs - (now() - startedAt),
  };

  /** Things the reader should know about how this run fell short, shown with the result. */
  const notes: string[] = [];
  const timeLeft = () => deps.limits.runDeadlineMs - (now() - startedAt);
  const hasTimeFor = (step: AgentId, what: string): boolean => {
    if (timeLeft() > deps.limits.optionalStepReserveMs) return true;
    emit({ type: "agent", agent: step, status: "skipped", message: `Skipped ${what}: the run is close to its time limit.` });
    notes.push(`${what} was skipped to stay inside the time limit.`);
    return false;
  };
  /**
   * For steps the run can finish without. Only a cancelled run stops here;
   * any other failure is recorded and the run carries on with what it has, so
   * a late gateway error never throws away a suite that is already written.
   * The two steps nothing can replace (Analyst, first draft) do not use this.
   */
  const carryOnAfter = (error: unknown, note: string): void => {
    if (signal.aborted) throw error;
    if (!(error instanceof AgentOutputError) && !(error instanceof UserFacingError)) {
      console.error("[pipeline] optional step failed:", error instanceof Error ? error.message : error);
    }
    notes.push(error instanceof UserFacingError ? `${note} (${error.message})` : note);
  };

  emit({
    type: "run_start",
    runId: deps.runId ?? "run",
    mode: deps.llm.mode,
    source: input.kind,
    title: input.kind === "github" ? input.url : (input.title ?? firstLine(input.text)),
  });

  try {
    // 1. Intake
    const story = await intake(input, deps, emit, now);
    emit({ type: "artifact", key: "story", data: story });

    // 2. Planner (the run survives without it)
    let plan: Plan;
    try {
      plan = await runPlanner(context, story);
    } catch (error) {
      carryOnAfter(error, "The Planner failed, so a neutral brief was used.");
      plan = fallbackPlan(story);
    }
    emit({ type: "artifact", key: "plan", data: plan });

    // 3. Analyst (required: everything downstream refers to its criteria)
    const criteria = await runAnalyst(context, story, plan);
    emit({ type: "artifact", key: "criteria", data: criteria });

    // 4. Specialists in parallel
    const { ambiguities, edgeCases, history } = await runSpecialists(context, deps, story, plan, criteria, carryOnAfter);
    emit({ type: "artifact", key: "ambiguities", data: ambiguities });
    emit({ type: "artifact", key: "edgeCases", data: edgeCases });
    if (history) emit({ type: "artifact", key: "history", data: history });

    // 5. Test Designer <-> Validator
    const brief: DesignBrief = { story, plan, criteria, edgeCases, ambiguities, history };
    let designRound = 0;
    let validateRound = 0;
    let fixRounds = 0;

    const design = (task: DesignTask) => {
      designRound += 1;
      return runTestDesigner(context, brief, task, designRound);
    };
    const validate = (feature: string): Draft => {
      validateRound += 1;
      // Code owns the @needs-clarification tag, so every draft is normalised before it is checked or shown.
      return validateDraft(markClarifications(feature), criteria, edgeCases, emit, now, validateRound);
    };
    /** Sends a failing draft back to the Test Designer until it passes or the cap is reached. */
    const fixUntilValid = async (draft: Draft): Promise<Draft> => {
      let current = draft;
      while (!current.report.ok && fixRounds < deps.limits.maxFixRounds && hasTimeFor("designer", "A fix round")) {
        fixRounds += 1;
        emit({
          type: "loop",
          from: "validator",
          to: "designer",
          round: fixRounds,
          max: deps.limits.maxFixRounds,
          reason: describeValidation(current.report),
        });
        // A sound file with coverage gaps only needs the missing scenarios, which
        // is quicker and cheaper than a rewrite and cannot lose existing coverage.
        const gapsOnly = current.parsed.ok && current.parsed.scenarios.length > 0 && current.report.stepIssues.length === 0;
        try {
          current = validate(await design({ kind: gapsOnly ? "extend" : "fix", previous: current.feature, report: current.report }));
        } catch (error) {
          carryOnAfter(error, "A fix round failed, so the earlier draft was kept.");
          break;
        }
      }
      return current;
    };

    let draft = await fixUntilValid(validate(await design({ kind: "initial" })));

    // 6. Skeptic, and at most one revision
    let review: Review | undefined;
    if (!draft.report.ok) {
      // The Skeptic reviews meaning, not syntax. A suite that fails the checks is not worth its time or tokens.
      emit({ type: "agent", agent: "skeptic", status: "skipped", message: "Skipped: the suite did not pass the automated checks, so there is nothing sound to review." });
      notes.push("The suite did not pass every automated check. The gaps are listed in the test plan.");
    } else if (hasTimeFor("skeptic", "The Skeptic's review")) {
      try {
        review = await runSkeptic(context, draft.feature, criteria, edgeCases, ambiguities);
        emit({ type: "artifact", key: "review", data: review });
      } catch (error) {
        carryOnAfter(error, "The Skeptic's review failed and was skipped.");
      }

      if (review?.verdict === "revise" && deps.limits.maxReviseRounds > 0 && hasTimeFor("designer", "The revision")) {
        const major = review.issues.filter((issue) => issue.severity === "major");
        emit({
          type: "loop",
          from: "skeptic",
          to: "designer",
          round: 1,
          max: deps.limits.maxReviseRounds,
          reason: major.map((issue) => issue.problem).join(" ").slice(0, 240),
        });
        try {
          const revised = await fixUntilValid(validate(await design({ kind: "revise", previous: draft.feature, issues: review.issues })));
          if (revised.report.ok) {
            draft = revised;
            review = { ...review, addressed: true };
            emit({ type: "artifact", key: "review", data: review });
          } else {
            // Never trade a suite that passes the checks for one that does not.
            notes.push("The revision failed the automated checks, so the earlier valid suite was kept.");
            emit({ type: "agent", agent: "validator", status: "skipped", message: "Revision rejected: keeping the earlier suite, which passed the checks." });
            emit({ type: "artifact", key: "feature", data: draft.feature });
            emit({ type: "artifact", key: "validation", data: draft.report });
          }
        } catch (error) {
          carryOnAfter(error, "The revision failed, so the earlier suite was kept.");
        }
      }
    }
    // 7. Risk Ranker
    let ranking: RankedScenario[] = [];
    if (draft.parsed.scenarios.length > 0) {
      try {
        ranking = hasTimeFor("ranker", "Risk ranking")
          ? await runRiskRanker(context, draft.parsed.scenarios, plan, ambiguities, history)
          : fallbackRanking(draft.parsed.scenarios);
      } catch (error) {
        carryOnAfter(error, "Risk ranking failed, so every scenario has the default priority.");
        ranking = fallbackRanking(draft.parsed.scenarios);
      }
    }
    emit({ type: "artifact", key: "ranking", data: ranking });

    // 8. Reporter (code)
    const reportStarted = now();
    emit({ type: "agent", agent: "reporter", status: "start" });
    const finalFeature = applyPriorityTags(
      draft.feature,
      draft.parsed.scenarios,
      new Map(ranking.map((item) => [item.id, item.priority])),
    );
    const exports = buildExports({
      story,
      plan,
      criteria,
      ambiguities,
      edgeCases,
      history,
      feature: finalFeature,
      featureName: draft.parsed.featureName,
      scenarios: draft.parsed.scenarios,
      validation: draft.report,
      review,
      ranking,
    });
    emit({ type: "artifact", key: "feature", data: finalFeature });
    emit({ type: "artifact", key: "exports", data: exports });
    emit({ type: "tool", agent: "reporter", tool: "export_artifacts", ok: true, message: `${exports.length} files built: ${exports.map((file) => file.name).join(", ")}.` });
    emit({ type: "agent", agent: "reporter", status: "done", ms: now() - reportStarted, message: "Test plan, feature file, Playwright stubs and Jira CSV are ready." });

    emit({
      type: "run_done",
      ms: now() - startedAt,
      ...usage.snapshot(),
      partial: notes.length > 0,
      note: notes.length ? notes.join(" ") : undefined,
    });
  } catch (error) {
    if (!(error instanceof UserFacingError) && !signal.aborted) {
      console.error("[pipeline] run failed:", error instanceof Error ? error.message : error);
    }
    const message = signal.aborted
      ? "The run was stopped before it finished. Anything already shown is still valid."
      : toUserMessage(error);
    emit({ type: "run_error", message });
  }
}

function firstLine(text: string): string {
  const line = text.split("\n").find((candidate) => candidate.trim().length > 0) ?? "Untitled requirement";
  return line.replace(/^#+\s*/, "").trim().slice(0, 80);
}

async function intake(input: RunInput, deps: PipelineDeps, emit: Emit, now: () => number): Promise<StoryDoc> {
  const started = now();
  const { maxInputChars, minInputChars } = deps.limits;
  emit({ type: "agent", agent: "intake", status: "start" });

  try {
    let story: StoryDoc;
    if (input.kind === "github") {
      const locator = parseIssueUrl(input.url);
      const issue = await deps.github.fetchIssue(locator);
      emit({
        type: "tool",
        agent: "intake",
        tool: "fetch_github_issue",
        ok: true,
        ms: now() - started,
        message: `${issue.repo}#${locator.number}: "${issue.title.slice(0, 80)}" with ${issue.comments.length} comment(s).`,
      });
      const full = [
        `# ${issue.title}`,
        issue.labels.length ? `Labels: ${issue.labels.join(", ")}` : "",
        issue.body,
        issue.comments.length ? `## Discussion\n${issue.comments.map((comment) => `- ${comment}`).join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      story = {
        source: "github",
        title: issue.title,
        text: full.slice(0, maxInputChars),
        repo: issue.repo,
        url: issue.url,
        truncated: full.length > maxInputChars,
      };
    } else {
      const text = input.text.trim();
      if (text.length > maxInputChars) {
        throw new UserFacingError(`That is longer than the ${maxInputChars.toLocaleString("en-US")} character limit. Please shorten it.`, 413);
      }
      story = { source: "text", title: input.title?.trim() || firstLine(text), text, truncated: false };
    }

    if (story.text.trim().length < minInputChars) {
      throw new UserFacingError("There is not enough text to analyse. Please give at least a couple of sentences.");
    }
    emit({
      type: "agent",
      agent: "intake",
      status: "done",
      ms: now() - started,
      message: `${story.text.length.toLocaleString("en-US")} characters${story.truncated ? " (truncated to the limit)" : ""}.`,
    });
    return story;
  } catch (error) {
    emit({ type: "agent", agent: "intake", status: "error", ms: now() - started, message: toUserMessage(error) });
    throw error;
  }
}

async function runSpecialists(
  context: AgentContext,
  deps: PipelineDeps,
  story: StoryDoc,
  plan: Plan,
  criteria: Criterion[],
  carryOnAfter: (error: unknown, note: string) => void,
): Promise<{ ambiguities: Ambiguity[]; edgeCases: EdgeCase[]; history?: HistoryReport }> {
  const wantsHistory = story.source === "github" && Boolean(story.repo) && deps.limits.maxHistorySearches > 0;

  if (!wantsHistory) {
    context.emit({ type: "agent", agent: "history", status: "skipped", message: "Skipped: the History Scout only runs for GitHub issues, where there is a repository to search." });
  }

  const [ambiguityResult, edgeResult, historyResult] = await Promise.allSettled([
    runAmbiguityHunter(context, story, plan, criteria),
    runEdgeCaseExplorer(context, story, plan, criteria),
    wantsHistory ? runHistoryScout(context, deps.github, story, deps.limits.maxHistorySearches) : Promise.resolve(undefined),
  ]);

  const settle = <T>(result: PromiseSettledResult<T>, fallback: T, label: string): T => {
    if (result.status === "fulfilled") return result.value;
    carryOnAfter(result.reason, `${label} failed and was left out.`);
    return fallback;
  };

  return {
    ambiguities: settle(ambiguityResult, [], "The Ambiguity Hunter"),
    edgeCases: settle(edgeResult, [], "The Edge-Case Explorer"),
    history: settle(historyResult, undefined, "The History Scout"),
  };
}

/** The Validator: two code tools, no model. */
function validateDraft(
  feature: string,
  criteria: Criterion[],
  edgeCases: EdgeCase[],
  emit: Emit,
  now: () => number,
  round: number,
): Draft {
  const started = now();
  emit({ type: "agent", agent: "validator", status: "start", round });

  const parsed = parseGherkin(feature);
  emit({
    type: "tool",
    agent: "validator",
    tool: "parse_gherkin",
    ok: parsed.ok,
    message: parsed.ok
      ? `Parsed: ${parsed.scenarios.length} scenarios.`
      : `${parsed.errors.length} parse error(s), first at line ${parsed.errors[0]?.line}: ${parsed.errors[0]?.message}`,
  });

  const report = checkCoverage(parsed, criteria, edgeCases);
  if (parsed.ok) {
    const coverageOk = report.uncoveredACs.length === 0 && report.uncoveredECs.length === 0 && report.stepIssues.length === 0;
    emit({ type: "tool", agent: "validator", tool: "check_coverage", ok: coverageOk, message: describeValidation(report) });
  }

  emit({ type: "artifact", key: "feature", data: feature });
  emit({ type: "artifact", key: "validation", data: report });
  emit({
    type: "agent",
    agent: "validator",
    status: report.ok ? "done" : "error",
    round,
    ms: now() - started,
    message: report.ok ? "All checks passed." : "Checks failed.",
  });
  return { feature, parsed, report };
}
