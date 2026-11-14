import { AwsDsqlRetryExhaustedError } from "@aws/aurora-dsql-drizzle";

/**
 * SQLSTATE codes worth translating into domain errors.
 * @link https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
export const sqlState = {
  uniqueViolation: "23505",
  foreignKeyViolation: "23503",
  checkViolation: "23514",
  /** Aurora DSQL optimistic concurrency conflict (OC000 data, OC001 schema). */
  serializationFailure: "40001",
} as const;

const maxCauseDepth = 5;
const sqlStatePattern = /^[0-9A-Z]{5}$/;

/**
 * Returns the SQLSTATE of a database error. Drizzle wraps driver errors in `DrizzleQueryError`
 * and keeps the driver error (which carries `code`) in `cause`, so the cause chain is searched.
 */
export function toSqlState(error: unknown): string | undefined {
  let current: unknown = error;

  for (let depth = 0; depth < maxCauseDepth; depth += 1) {
    if (typeof current !== "object" || current == null) {
      return undefined;
    }

    if (
      "code" in current &&
      typeof current.code === "string" &&
      sqlStatePattern.test(current.code)
    ) {
      return current.code;
    }

    current = "cause" in current ? current.cause : undefined;
  }

  return undefined;
}

export const isUniqueViolation = (error: unknown): boolean =>
  toSqlState(error) === sqlState.uniqueViolation;

export const isForeignKeyViolation = (error: unknown): boolean =>
  toSqlState(error) === sqlState.foreignKeyViolation;

export const isCheckViolation = (error: unknown): boolean =>
  toSqlState(error) === sqlState.checkViolation;

export const isSerializationFailure = (error: unknown): boolean =>
  toSqlState(error) === sqlState.serializationFailure;

/** The adapter gave up retrying an optimistic concurrency conflict (`transactionWithRetry`). */
export const isRetryExhausted = (error: unknown): error is AwsDsqlRetryExhaustedError =>
  error instanceof AwsDsqlRetryExhaustedError;
