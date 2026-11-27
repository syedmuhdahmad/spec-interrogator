/**
 * An error whose message is safe to show to a visitor.
 * Anything else is logged on the server and replaced with a generic message.
 */
export class UserFacingError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = "UserFacingError";
  }
}

/** The run spent its token allowance. */
export class BudgetError extends UserFacingError {
  constructor(message: string) {
    super(message, 429);
    this.name = "BudgetError";
  }
}

/** An agent could not produce usable output after its retry. */
export class AgentOutputError extends Error {
  constructor(
    readonly agent: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentOutputError";
  }
}

export function toUserMessage(error: unknown): string {
  if (error instanceof UserFacingError) return error.message;
  if (error instanceof AgentOutputError) {
    return `The ${error.agent} agent returned output that could not be used.`;
  }
  return "Something went wrong while running the agents. Please try again.";
}
