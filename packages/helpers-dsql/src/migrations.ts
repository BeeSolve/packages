import { createHash } from "node:crypto";

import { readMigrationFiles } from "drizzle-orm/migrator";
import * as v from "valibot";

import type { SqlClient } from "./access/state";

export type RepairResult =
  | { readonly kind: "nothing-pending" }
  | {
      readonly kind: "recorded";
      readonly folderMillis: number;
      readonly statementIndex: number;
      readonly statement: string;
    }
  | {
      readonly kind: "not-repairable";
      readonly folderMillis: number;
      readonly statementIndex: number;
      readonly statement: string;
      readonly reason: string;
    };

const appliedRowSchema = v.object({
  migration_folder_millis: v.union([v.string(), v.number()]),
  statement_index: v.number(),
});
const indexRowSchema = v.object({ valid: v.boolean() });
const constraintRowSchema = v.object({ validated: v.boolean() });

const quotedIdentifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Recovers a migration run that stopped while DSQL was still building an index or validating a
 * constraint. `@aws/aurora-dsql-drizzle` records an ASYNC statement only after
 * `sys.wait_for_job` returns; if the client stops while waiting, the job can still finish and a
 * re-run then fails with 42P07 ("already exists").
 *
 * Looks at the FIRST pending statement only. It is recorded as applied, exactly as the adapter
 * would record it, when it is `CREATE [UNIQUE] INDEX ASYNC "<name>"` and that index is valid, or
 * `ALTER TABLE ASYNC ... VALIDATE CONSTRAINT "<name>"` and that constraint is validated.
 * Anything else is left alone.
 *
 * Coupled to the adapter's tracking table (columns and sha256 of the trimmed statement), as of
 * `@aws/aurora-dsql-drizzle` 0.2.
 */
export async function repairFirstPendingMigration(props: {
  readonly client: SqlClient;
  readonly migrationsFolder: string;
  readonly migrationsSchema?: string;
  readonly migrationsTable?: string;
}): Promise<RepairResult> {
  const { client } = props;
  const migrationsSchema = props.migrationsSchema ?? "drizzle";
  const migrationsTable = props.migrationsTable ?? "__drizzle_migrations";
  for (const identifier of [migrationsSchema, migrationsTable]) {
    if (!quotedIdentifierPattern.test(identifier)) {
      throw new Error(`Invalid migrations table identifier "${identifier}".`);
    }
  }
  const tracking = `"${migrationsSchema}"."${migrationsTable}"`;

  const appliedRows = await client.query(
    `SELECT migration_folder_millis, statement_index FROM ${tracking}`,
  );
  const applied = new Set(
    appliedRows.rows.map((row) => {
      const parsed = v.parse(appliedRowSchema, row);
      return `${Number(parsed.migration_folder_millis)}:${parsed.statement_index}`;
    }),
  );

  for (const migration of readMigrationFiles({ migrationsFolder: props.migrationsFolder })) {
    for (const [statementIndex, raw] of migration.sql.entries()) {
      if (applied.has(`${migration.folderMillis}:${statementIndex}`)) {
        continue;
      }

      const statement = raw.trim();
      const pending = { folderMillis: migration.folderMillis, statementIndex, statement };
      const indexName = /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+ASYNC\s+"([^"]+)"/i.exec(statement)?.[1];
      const constraintName =
        /^ALTER\s+TABLE\s+ASYNC\s+"[^"]+"\s+VALIDATE\s+CONSTRAINT\s+"([^"]+)"/i.exec(
          statement,
        )?.[1];

      let done: boolean;
      if (indexName != null) {
        const { rows } = await client.query(
          `SELECT i.indisvalid AS valid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = $1`,
          [indexName],
        );
        done = rows[0] != null && v.parse(indexRowSchema, rows[0]).valid;
        if (!done) {
          return {
            kind: "not-repairable",
            ...pending,
            reason: `Index ${indexName} is missing or not valid yet.`,
          };
        }
      } else if (constraintName != null) {
        const { rows } = await client.query(
          "SELECT convalidated AS validated FROM pg_constraint WHERE conname = $1",
          [constraintName],
        );
        done = rows[0] != null && v.parse(constraintRowSchema, rows[0]).validated;
        if (!done) {
          return {
            kind: "not-repairable",
            ...pending,
            reason: `Constraint ${constraintName} is missing or not validated yet.`,
          };
        }
      } else {
        return {
          kind: "not-repairable",
          ...pending,
          reason: "Not an ASYNC index or validation statement.",
        };
      }

      await client.query(
        `INSERT INTO ${tracking} (migration_hash, migration_folder_millis, statement_index, statement_hash)
         VALUES ($1, $2, $3, $4) ON CONFLICT (migration_folder_millis, statement_index) DO NOTHING`,
        [
          migration.hash,
          migration.folderMillis,
          statementIndex,
          createHash("sha256").update(statement).digest("hex"),
        ],
      );
      return { kind: "recorded", ...pending };
    }
  }
  return { kind: "nothing-pending" };
}

/**
 * Diagnostics for a migration that seems stuck: DSQL background jobs (`sys.jobs`) and the
 * indexes of `schema` with their validity. Read-only.
 */
export async function readAsyncJobs(props: {
  readonly client: SqlClient;
  readonly schema?: string;
}): Promise<{ readonly jobs: ReadonlyArray<unknown>; readonly indexes: ReadonlyArray<unknown> }> {
  const jobs = await props.client.query("SELECT * FROM sys.jobs");
  const indexes = await props.client.query(
    `SELECT c.relname AS index, t.relname AS table, i.indisvalid AS valid, i.indisready AS ready
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indexrelid
       JOIN pg_class t ON t.oid = i.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = $1
      ORDER BY t.relname, c.relname`,
    [props.schema ?? "public"],
  );
  return { jobs: jobs.rows, indexes: indexes.rows };
}
