import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

export const backfillStatuses = ["pending", "started", "finished", "failed"] as const;

export type BackfillStatus = (typeof backfillStatuses)[number];

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
 * - status `started` or `pending` → canRun false (a run is in flight)
 * - status `finished` or `failed` → canRun true
 */
export function deriveCanRun(config: BackfillConfig | null, domain: string): boolean {
  if (config == null) return true;

  const entry = config.domains[domain];
  if (entry == null) return true;

  return entry.status !== "started" && entry.status !== "pending";
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
   * Atomically starts a backfill run for a domain in a single transaction that
   * BOTH marks the domain as `started` in the config record AND writes the
   * `run#<runId>` history item. Either both land or neither does.
   *
   * The config Update is guarded by a ConditionExpression on the nested
   * `domains.<domain>.status` value so a second concurrent start (double-click
   * / already-running) fails: the write is allowed only when the `domains`
   * attribute is missing, the domain entry is missing, or its status is a
   * terminal value (`finished`/`failed`). The domain name is referenced via an
   * expression attribute name because it may contain dots or other characters
   * that are invalid in a document path.
   *
   * The history Put is guarded so an existing run item is never overwritten.
   * Because the run item uses a composite key, the guard checks BOTH key
   * attributes (`pk` AND `sk`).
   *
   * When either guard fails, DynamoDB cancels the transaction and throws a
   * `TransactionCanceledException`. This is intentionally NOT caught here so
   * callers can detect the "already-running" condition.
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
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.props.tableName,
              Key: { pk: "system#config", sk: "ipBackfill" },
              UpdateExpression: "SET #domains.#domain = :entry",
              ConditionExpression:
                "attribute_not_exists(#domains) OR attribute_not_exists(#domains.#domain) OR #domains.#domain.#status IN (:finished, :failed)",
              ExpressionAttributeNames: {
                "#domains": "domains",
                "#domain": props.domain,
                "#status": "status",
              },
              ExpressionAttributeValues: {
                ":entry": entry,
                ":finished": "finished",
                ":failed": "failed",
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

  readonly putRunHistory = async (props: {
    readonly domain: string;
    readonly runId: string;
    readonly status: BackfillStatus;
    readonly startedAt: string;
    readonly finishedAt?: string;
    readonly ipsEnriched?: number;
    readonly reportsScanned?: number;
    readonly error?: string;
  }): Promise<void> => {
    const item: BackfillRun = {
      pk: runKeyFor(props.domain),
      sk: runSortKeyFor(props.runId),
      domain: props.domain,
      runId: props.runId,
      status: props.status,
      startedAt: props.startedAt,
      finishedAt: props.finishedAt,
      ipsEnriched: props.ipsEnriched,
      reportsScanned: props.reportsScanned,
      error: props.error,
    };

    await this.props.dynamo.send(new PutCommand({ TableName: this.props.tableName, Item: item }));
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
