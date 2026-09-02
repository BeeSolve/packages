import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

export const backfillStatuses = ["pending", "started", "finished", "failed"] as const;

export type BackfillStatus = (typeof backfillStatuses)[number];

const staleRunAfterMs = 10 * 60 * 1000;

function isStaleStartedAt(startedAt: string, now: number): boolean {
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return false;
  return now - started > staleRunAfterMs;
}

export const backfillDomainEntrySchema = v.object({
  status: v.picklist(backfillStatuses),
  runId: v.string(),
  startedAt: v.string(),
  finishedAt: v.optional(v.string()),
  ipsEnriched: v.optional(v.number()),
  reportsScanned: v.optional(v.number()),
  error: v.optional(v.string()),
});

export type BackfillDomainEntry = v.InferOutput<typeof backfillDomainEntrySchema>;

export const backfillConfigSchema = v.object({
  pk: v.literal("system#config"),
  sk: v.literal("ipBackfill"),
  domains: v.record(v.string(), backfillDomainEntrySchema),
});

export type BackfillConfig = v.InferOutput<typeof backfillConfigSchema>;

export const backfillRunSchema = v.object({
  pk: v.string(),
  sk: v.string(),
  domain: v.string(),
  runId: v.string(),
  status: v.picklist(backfillStatuses),
  startedAt: v.string(),
  finishedAt: v.optional(v.string()),
  ipsEnriched: v.optional(v.number()),
  reportsScanned: v.optional(v.number()),
  error: v.optional(v.string()),
});

export type BackfillRun = v.InferOutput<typeof backfillRunSchema>;

export const backfillStatusSummarySchema = v.object({
  canRun: v.boolean(),
  lastRun: v.optional(
    v.object({
      status: v.picklist(backfillStatuses),
      startedAt: v.string(),
      finishedAt: v.optional(v.string()),
      ipsEnriched: v.optional(v.number()),
    }),
  ),
});

export type BackfillStatusSummary = v.InferOutput<typeof backfillStatusSummarySchema>;

/**
 * Derives whether a backfill can be started for a domain given the current
 * config record. Semantics:
 * - config not found → canRun true
 * - domain absent from the config → canRun true
 * - status `finished` or `failed` → canRun true
 * - status `started` or `pending` → canRun false, unless the run is stale
 *   (older than the worker's max lifetime), in which case it is re-runnable so
 *   a crashed or timed-out worker does not pin the domain forever.
 */
export function deriveCanRun(config: BackfillConfig | null, domain: string): boolean {
  if (config == null) return true;

  const entry = config.domains[domain];
  if (entry == null) return true;

  if (entry.status === "finished" || entry.status === "failed") return true;

  return isStaleStartedAt(entry.startedAt, Date.now());
}

function runKeyFor(domain: string): string {
  return `backfill#${domain}`;
}

function runSortKeyFor(runId: string): string {
  return `run#${runId}`;
}

export class Backfill {
  constructor(
    private readonly props: {
      readonly dynamo: Pick<DynamoDBDocumentClient, "send">;
      readonly tableName: string;
    },
  ) {}

  readonly readConfig = async (): Promise<BackfillConfig | null> => {
    const { Item: item } = await this.props.dynamo.send(
      new GetCommand({
        TableName: this.props.tableName,
        Key: { pk: "system#config", sk: "ipBackfill" },
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
    const entry: BackfillDomainEntry = {
      status: "started",
      runId: props.runId,
      startedAt: props.startedAt,
    };

    const runItem: BackfillRun = {
      pk: runKeyFor(props.domain),
      sk: runSortKeyFor(props.runId),
      domain: props.domain,
      runId: props.runId,
      status: "started",
      startedAt: props.startedAt,
    };

    await this.props.dynamo.send(
      new UpdateCommand({
        TableName: this.props.tableName,
        Key: { pk: "system#config", sk: "ipBackfill" },
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
              Key: { pk: "system#config", sk: "ipBackfill" },
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
   * Marks a run as `finished`, recording counts. Atomically updates BOTH the
   * config domain entry (nested map) and the `run#<runId>` history item by key
   * in a single transaction, so both land or neither does.
   */
  readonly completeRun = async (props: {
    readonly domain: string;
    readonly runId: string;
    readonly ipsEnriched: number;
    readonly reportsScanned: number;
  }): Promise<void> => {
    const finishedAt = new Date().toISOString();

    await this.props.dynamo.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.props.tableName,
              Key: { pk: "system#config", sk: "ipBackfill" },
              UpdateExpression:
                "SET #domains.#domain.#status = :status, #domains.#domain.#finishedAt = :finishedAt, #domains.#domain.#ipsEnriched = :ipsEnriched, #domains.#domain.#reportsScanned = :reportsScanned",
              ExpressionAttributeNames: {
                "#domains": "domains",
                "#domain": props.domain,
                "#status": "status",
                "#finishedAt": "finishedAt",
                "#ipsEnriched": "ipsEnriched",
                "#reportsScanned": "reportsScanned",
              },
              ExpressionAttributeValues: {
                ":status": "finished",
                ":finishedAt": finishedAt,
                ":ipsEnriched": props.ipsEnriched,
                ":reportsScanned": props.reportsScanned,
              },
            },
          },
          {
            Update: {
              TableName: this.props.tableName,
              Key: { pk: runKeyFor(props.domain), sk: runSortKeyFor(props.runId) },
              UpdateExpression:
                "SET #status = :status, #finishedAt = :finishedAt, #ipsEnriched = :ipsEnriched, #reportsScanned = :reportsScanned",
              ExpressionAttributeNames: {
                "#status": "status",
                "#finishedAt": "finishedAt",
                "#ipsEnriched": "ipsEnriched",
                "#reportsScanned": "reportsScanned",
              },
              ExpressionAttributeValues: {
                ":status": "finished",
                ":finishedAt": finishedAt,
                ":ipsEnriched": props.ipsEnriched,
                ":reportsScanned": props.reportsScanned,
              },
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
              Key: { pk: "system#config", sk: "ipBackfill" },
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
              Key: { pk: runKeyFor(props.domain), sk: runSortKeyFor(props.runId) },
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

  private readonly parseConfig = (item: unknown): BackfillConfig => {
    const result = v.safeParse(backfillConfigSchema, item);
    if (!result.success) {
      console.error(v.flatten(result.issues));
      throw new Error("Malformed stored backfill config record");
    }
    return result.output;
  };
}
