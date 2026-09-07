import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

export const jobKinds = ["ipBackfill", "dnsRefresh"] as const;

export type JobKind = (typeof jobKinds)[number];

export const jobRunStatuses = ["pending", "started", "finished", "failed"] as const;

export type JobRunStatus = (typeof jobRunStatuses)[number];

const staleRunAfterMs = 10 * 60 * 1000;

function isStaleStartedAt(startedAt: string, now: number): boolean {
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return false;
  return now - started > staleRunAfterMs;
}

function runKeyFor(kind: JobKind, domain: string): string {
  const prefix = kind === "ipBackfill" ? "backfill" : "dnsRefresh";
  return `${prefix}#${domain}`;
}

function runSortKeyFor(runId: string): string {
  return `run#${runId}`;
}

export const jobRunEntrySchema = v.object({
  status: v.picklist(jobRunStatuses),
  runId: v.string(),
  startedAt: v.string(),
  finishedAt: v.optional(v.string()),
  ipsEnriched: v.optional(v.number()),
  reportsScanned: v.optional(v.number()),
  selectorsChecked: v.optional(v.number()),
  error: v.optional(v.string()),
});

export type JobRunEntry = v.InferOutput<typeof jobRunEntrySchema>;

export const jobRunConfigSchema = v.object({
  pk: v.literal("system#config"),
  sk: v.picklist(jobKinds),
  domains: v.record(v.string(), jobRunEntrySchema),
});

export type JobRunConfig = v.InferOutput<typeof jobRunConfigSchema>;

export const jobRunSchema = v.object({
  pk: v.string(),
  sk: v.string(),
  domain: v.string(),
  runId: v.string(),
  status: v.picklist(jobRunStatuses),
  startedAt: v.string(),
  finishedAt: v.optional(v.string()),
  ipsEnriched: v.optional(v.number()),
  reportsScanned: v.optional(v.number()),
  selectorsChecked: v.optional(v.number()),
  error: v.optional(v.string()),
});

export type JobRun = v.InferOutput<typeof jobRunSchema>;

export const jobStatusSummarySchema = v.object({
  canRun: v.boolean(),
  lastRun: v.optional(
    v.object({
      status: v.picklist(jobRunStatuses),
      startedAt: v.string(),
      finishedAt: v.optional(v.string()),
      ipsEnriched: v.optional(v.number()),
      selectorsChecked: v.optional(v.number()),
    }),
  ),
});

export type JobStatusSummary = v.InferOutput<typeof jobStatusSummarySchema>;

export const jobRunCounts = ["ipsEnriched", "reportsScanned", "selectorsChecked"] as const;

export type JobRunCounts = Partial<Record<(typeof jobRunCounts)[number], number>>;

/**
 * Derives whether a run can be started for a domain given the current config
 * record. Semantics:
 * - config not found → canRun true
 * - domain absent from the config → canRun true
 * - status `finished` or `failed` → canRun true
 * - status `started` or `pending` → canRun false, unless the run is stale
 *   (older than the worker's max lifetime), in which case it is re-runnable so
 *   a crashed or timed-out worker does not pin the domain forever.
 */
export function deriveCanRun(config: JobRunConfig | null, domain: string): boolean {
  if (config == null) return true;

  const entry = config.domains[domain];
  if (entry == null) return true;

  if (entry.status === "finished" || entry.status === "failed") return true;

  return isStaleStartedAt(entry.startedAt, Date.now());
}

export class JobRuns {
  constructor(
    private readonly props: {
      readonly dynamo: Pick<DynamoDBDocumentClient, "send">;
      readonly tableName: string;
      readonly kind: JobKind;
    },
  ) {}

  readonly readConfig = async (): Promise<JobRunConfig | null> => {
    const { Item: item } = await this.props.dynamo.send(
      new GetCommand({
        TableName: this.props.tableName,
        Key: { pk: "system#config", sk: this.props.kind },
      }),
    );

    if (item == null) return null;
    return this.parseConfig(item);
  };

  /**
   * Starts a run for a domain. First seeds the config item's `domains` map
   * idempotently (so the nested `SET domains.<domain>` in the guarded
   * transaction has a parent map to write into), then atomically marks the
   * domain `started` and writes the `run#<runId>` history item in one
   * transaction. The config update is guarded so a concurrent, non-stale run
   * fails; the history put is guarded so an existing run item is never
   * overwritten. A failed guard cancels the transaction with
   * `TransactionCanceledException`, left uncaught so callers can detect the
   * already-running case.
   */
  readonly startRun = async (props: {
    readonly domain: string;
    readonly runId: string;
    readonly startedAt: string;
  }): Promise<void> => {
    const entry: JobRunEntry = {
      status: "started",
      runId: props.runId,
      startedAt: props.startedAt,
    };

    const runItem: JobRun = {
      pk: runKeyFor(this.props.kind, props.domain),
      sk: runSortKeyFor(props.runId),
      domain: props.domain,
      runId: props.runId,
      status: "started",
      startedAt: props.startedAt,
    };

    await this.props.dynamo.send(
      new UpdateCommand({
        TableName: this.props.tableName,
        Key: { pk: "system#config", sk: this.props.kind },
        UpdateExpression: "SET #domains = if_not_exists(#domains, :empty)",
        ExpressionAttributeNames: { "#domains": "domains" },
        ExpressionAttributeValues: { ":empty": {} },
      }),
    );

    const staleBefore = new Date(Date.parse(props.startedAt) - staleRunAfterMs).toISOString();

    await this.props.dynamo.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.props.tableName,
              Key: { pk: "system#config", sk: this.props.kind },
              UpdateExpression: "SET #domains.#domain = :entry",
              ConditionExpression:
                "attribute_not_exists(#domains.#domain) OR #domains.#domain.#status IN (:finished, :failed) OR #domains.#domain.#startedAt < :staleBefore",
              ExpressionAttributeNames: {
                "#domains": "domains",
                "#domain": props.domain,
                "#status": "status",
                "#startedAt": "startedAt",
              },
              ExpressionAttributeValues: {
                ":entry": entry,
                ":finished": "finished",
                ":failed": "failed",
                ":staleBefore": staleBefore,
              },
            },
          },
          {
            Put: {
              TableName: this.props.tableName,
              Item: runItem,
              ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
            },
          },
        ],
      }),
    );
  };

  /**
   * Marks a run as `finished`, recording the provided counts. Atomically
   * updates BOTH the config domain entry (nested map) and the `run#<runId>`
   * history item by key in a single transaction, so both land or neither does.
   * Only the counts actually present are written.
   */
  readonly completeRun = async (props: {
    readonly domain: string;
    readonly runId: string;
    readonly counts?: JobRunCounts;
  }): Promise<void> => {
    const finishedAt = new Date().toISOString();
    const counts = props.counts ?? {};

    const setStatus = "#status = :status, #finishedAt = :finishedAt";
    const names: Record<string, string> = {
      "#status": "status",
      "#finishedAt": "finishedAt",
    };
    const values: Record<string, unknown> = {
      ":status": "finished",
      ":finishedAt": finishedAt,
    };

    const configAssignments: Array<string> = [
      "#domains.#domain.#status = :status",
      "#domains.#domain.#finishedAt = :finishedAt",
    ];
    const runAssignments: Array<string> = [setStatus];
    const configNames: Record<string, string> = {
      "#domains": "domains",
      "#domain": props.domain,
      "#status": "status",
      "#finishedAt": "finishedAt",
    };

    for (const countName of jobRunCounts) {
      const countValue = counts[countName];
      if (countValue == null) continue;
      const nameToken = `#${countName}`;
      const valueToken = `:${countName}`;
      names[nameToken] = countName;
      configNames[nameToken] = countName;
      values[valueToken] = countValue;
      configAssignments.push(`#domains.#domain.${nameToken} = ${valueToken}`);
      runAssignments.push(`${nameToken} = ${valueToken}`);
    }

    await this.props.dynamo.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.props.tableName,
              Key: { pk: "system#config", sk: this.props.kind },
              UpdateExpression: `SET ${configAssignments.join(", ")}`,
              ExpressionAttributeNames: configNames,
              ExpressionAttributeValues: values,
            },
          },
          {
            Update: {
              TableName: this.props.tableName,
              Key: {
                pk: runKeyFor(this.props.kind, props.domain),
                sk: runSortKeyFor(props.runId),
              },
              UpdateExpression: `SET ${runAssignments.join(", ")}`,
              ExpressionAttributeNames: names,
              ExpressionAttributeValues: values,
            },
          },
        ],
      }),
    );
  };

  /**
   * Marks a run as `failed`, recording the error. Atomically updates BOTH the
   * config domain entry (nested map) and the `run#<runId>` history item by key
   * in a single transaction, so both land or neither does.
   */
  readonly failRun = async (props: {
    readonly domain: string;
    readonly runId: string;
    readonly error: string;
  }): Promise<void> => {
    const finishedAt = new Date().toISOString();

    await this.props.dynamo.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.props.tableName,
              Key: { pk: "system#config", sk: this.props.kind },
              UpdateExpression:
                "SET #domains.#domain.#status = :status, #domains.#domain.#finishedAt = :finishedAt, #domains.#domain.#error = :error",
              ExpressionAttributeNames: {
                "#domains": "domains",
                "#domain": props.domain,
                "#status": "status",
                "#finishedAt": "finishedAt",
                "#error": "error",
              },
              ExpressionAttributeValues: {
                ":status": "failed",
                ":finishedAt": finishedAt,
                ":error": props.error,
              },
            },
          },
          {
            Update: {
              TableName: this.props.tableName,
              Key: {
                pk: runKeyFor(this.props.kind, props.domain),
                sk: runSortKeyFor(props.runId),
              },
              UpdateExpression: "SET #status = :status, #finishedAt = :finishedAt, #error = :error",
              ExpressionAttributeNames: {
                "#status": "status",
                "#finishedAt": "finishedAt",
                "#error": "error",
              },
              ExpressionAttributeValues: {
                ":status": "failed",
                ":finishedAt": finishedAt,
                ":error": props.error,
              },
            },
          },
        ],
      }),
    );
  };

  private readonly parseConfig = (item: unknown): JobRunConfig => {
    const result = v.safeParse(jobRunConfigSchema, item);
    if (!result.success) {
      console.error(v.flatten(result.issues));
      throw new Error("Malformed stored job run config record");
    }
    return result.output;
  };
}
