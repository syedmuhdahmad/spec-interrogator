import { BudgetError } from "@/lib/core/errors";
import type { ModelPrice } from "@/lib/config";
import type { ModelTier } from "@/lib/agents/registry";

/**
 * Counts what a single run spends and stops it when it goes over its
 * allowance. One meter per run.
 */
export class UsageMeter {
  private calls = 0;
  private tokensIn = 0;
  private tokensOut = 0;
  private costUsd = 0;

  constructor(
    private readonly maxTokens: number,
    private readonly prices: Record<ModelTier, ModelPrice>,
  ) {}

  /** Call before each model request: refuses to start one the run cannot afford. */
  assertWithinBudget(): void {
    if (this.tokensIn + this.tokensOut >= this.maxTokens) {
      throw new BudgetError(
        `This run reached its limit of ${this.maxTokens.toLocaleString("en-US")} tokens and was stopped.`,
      );
    }
  }

  record(tier: ModelTier, tokensIn: number, tokensOut: number): void {
    this.calls += 1;
    this.tokensIn += tokensIn;
    this.tokensOut += tokensOut;
    const price = this.prices[tier];
    this.costUsd += (tokensIn * price.inPerM + tokensOut * price.outPerM) / 1_000_000;
  }

  snapshot(): { llmCalls: number; tokensIn: number; tokensOut: number; estCostUsd: number } {
    return {
      llmCalls: this.calls,
      tokensIn: this.tokensIn,
      tokensOut: this.tokensOut,
      estCostUsd: Math.round(this.costUsd * 10_000) / 10_000,
    };
  }
}
