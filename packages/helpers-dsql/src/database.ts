import {
  type AwsDsqlDatabase,
  type AwsDsqlRetryConfig,
  type AwsDsqlRetryExhaustedError,
  drizzle,
} from "@aws/aurora-dsql-drizzle";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import type { Pool } from "pg";

import type { DsqlConfig } from "./env";
import { isRetryExhausted } from "./errors";

type AnySchema = Record<string, unknown>;

/**
 * The common base of the DSQL database and a plain PostgreSQL one (for example PGlite in unit
 * tests). Code that depends only on this type runs against either.
 */
export type Db<TSchema extends AnySchema> = PgDatabase<
  PgQueryResultHKT,
  TSchema,
  ExtractTablesWithRelations<TSchema>
>;

/** What a transaction callback receives. Also valid wherever a {@link Db} query is built. */
export type Tx<TSchema extends AnySchema> = PgTransaction<
  PgQueryResultHKT,
  TSchema,
  ExtractTablesWithRelations<TSchema>
>;

/** Anything statements can run on: the database itself or an open transaction. */
export type Executor<TSchema extends AnySchema> = Db<TSchema> | Tx<TSchema>;

/**
 * Runs `fn` in one transaction. On DSQL, optimistic concurrency conflicts (SQLSTATE 40001) are
 * retried, so `fn` may run more than once and must not cause side effects outside the database.
 */
export type Transact<TSchema extends AnySchema> = <T>(
  fn: (tx: Tx<TSchema>) => Promise<T>,
) => Promise<T>;

/** Constructor props for repositories: `new Users({ db, transact })`. */
export type DbProps<TSchema extends AnySchema> = {
  readonly db: Db<TSchema>;
  readonly transact: Transact<TSchema>;
};

export type DsqlDatabase<TSchema extends AnySchema> = {
  /** The adapter's database; `db.$client` is the `pg` pool (needed by `migrate`). */
  readonly db: AwsDsqlDatabase<TSchema> & { $client: Pool };
  readonly transact: Transact<TSchema>;
};

export type CreateDsqlDatabaseProps<TSchema extends AnySchema> = {
  readonly config: DsqlConfig;
  readonly schema?: TSchema;
  readonly casing?: "snake_case" | "camelCase";
  readonly retry?: AwsDsqlRetryConfig;
  /**
   * Maps the error thrown when every retry hit a conflict, for example to a "please try again"
   * domain error. The original error is rethrown when omitted.
   */
  readonly toRetryExhaustedError?: (error: AwsDsqlRetryExhaustedError) => unknown;
  /** Called for errors on idle pooled connections. Defaults to `console.error`. */
  readonly onIdleConnectionError?: (error: Error) => void;
};

/**
 * Creates the Drizzle database for a DSQL cluster. Call it once per Lambda container (at module
 * level): the pool opens connections lazily and the connector creates a fresh IAM token for each
 * new connection. DSQL closes connections after one hour; the pool replaces them.
 */
export function createDsqlDatabase<TSchema extends AnySchema = Record<string, never>>(
  props: CreateDsqlDatabaseProps<TSchema>,
): DsqlDatabase<TSchema> {
  const { config } = props;
  const db = drizzle<TSchema>({
    connection: {
      host: config.host,
      region: config.region,
      user: config.user,
      ...(config.profile ? { profile: config.profile } : {}),
    },
    ...(props.schema == null ? {} : { schema: props.schema }),
    ...(props.casing == null ? {} : { casing: props.casing }),
  });

  // Without a listener Node treats an error emitted by an idle pooled connection (for example
  // at the one-hour limit) as an uncaught exception.
  const onIdleConnectionError =
    props.onIdleConnectionError ??
    ((error: Error) => console.error("Idle DSQL connection error", error.message));
  db.$client.on("error", onIdleConnectionError);

  const transact: Transact<TSchema> = async (fn) => {
    try {
      return await db.transactionWithRetry(fn, undefined, props.retry);
    } catch (error) {
      if (props.toRetryExhaustedError != null && isRetryExhausted(error)) {
        throw props.toRetryExhaustedError(error);
      }
      throw error;
    }
  };

  return { db, transact };
}
