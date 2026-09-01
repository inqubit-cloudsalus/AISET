/** Errors that are expected, actionable, and printed without a stack trace. */
export class AisetError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "AisetError";
  }
}

export class NotFoundError extends AisetError {
  constructor(what: string, id: string) {
    super(`${what} not found: ${id}`);
    this.name = "NotFoundError";
  }
}

/** Thrown when a DB row does not match its Zod schema — schema drift must fail loudly. */
export class SchemaDriftError extends AisetError {
  constructor(table: string, detail: string) {
    super(
      `row in "${table}" does not match its schema: ${detail}`,
      "the database is newer or older than this binary; run `aiset db status`",
    );
    this.name = "SchemaDriftError";
  }
}
