import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DeleteCommand, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { queryAll } from "@beesolve/dynamo-helpers";
import * as v from "valibot";

import type { WatchEntryRecord, WatchMode, WatchSource, WatchStatus } from "./watch.ts";
import { watchConfigKey, watchConfigSk, watchEntrySchema, watchPkPrefix } from "./watch.ts";

export const configSchema = v.object({
  pk: v.literal("system#config"),
  sk: v.literal("analytics"),
  startKey: v.string(),
  startedAt: v.string(),
  sitemapUrl: v.optional(v.string()),
});
export type AnalyticsConfig = v.InferOutput<typeof configSchema>;

const sitemapConfigSchema = v.looseObject({
  sitemapUrl: v.optional(v.string()),
});
export type SitemapConfig = v.InferOutput<typeof sitemapConfigSchema>;

const configKey = { pk: "system#config", sk: "analytics" } as const;

function isConditionalCheckFailure(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const name = "name" in error ? error.name : undefined;
  return name === "ConditionalCheckFailedException";
}

export class Config {
  constructor(
    private readonly props: {
      readonly dynamo: Pick<DynamoDBDocumentClient, "send">;
      readonly tableName: string;
      readonly reverseIndexName?: string;
    },
  ) {}

  readonly get = async (): Promise<AnalyticsConfig | null> => {
    const { Item: item } = await this.props.dynamo.send(
      new GetCommand({ TableName: this.props.tableName, Key: configKey }),
    );
    if (item == null) return null;
    return v.parse(configSchema, item);
  };

  readonly getSitemapConfig = async (): Promise<SitemapConfig> => {
    const { Item: item } = await this.props.dynamo.send(
      new GetCommand({ TableName: this.props.tableName, Key: configKey }),
    );
    if (item == null) return {};
    return v.parse(sitemapConfigSchema, item);
  };

  readonly setSitemapUrl = async ({
    sitemapUrl,
  }: {
    readonly sitemapUrl: string;
  }): Promise<void> => {
    await this.props.dynamo.send(
      new UpdateCommand({
        TableName: this.props.tableName,
        Key: configKey,
        UpdateExpression: "SET #sitemapUrl = :url",
        ExpressionAttributeNames: { "#sitemapUrl": "sitemapUrl" },
        ExpressionAttributeValues: { ":url": sitemapUrl },
      }),
    );
  };

  /**
   * Records the earliest ingested hour the first time any data lands, so the UI
   * can clamp navigation to [startKey, now]. Idempotent: once `startKey` exists
   * it is never moved forward, and a conditional guard lets it move earlier only
   * when a backfill ingests an hour older than the stored boundary.
   */
  readonly ensureStart = async (props: { readonly hourKey: string }): Promise<void> => {
    try {
      await this.props.dynamo.send(
        new UpdateCommand({
          TableName: this.props.tableName,
          Key: configKey,
          UpdateExpression:
            "SET #startKey = :hourKey, #startedAt = if_not_exists(#startedAt, :now)",
          ConditionExpression: "attribute_not_exists(#startKey) OR :hourKey < #startKey",
          ExpressionAttributeNames: {
            "#startKey": "startKey",
            "#startedAt": "startedAt",
          },
          ExpressionAttributeValues: {
            ":hourKey": props.hourKey,
            ":now": new Date().toISOString(),
          },
        }),
      );
    } catch (error) {
      if (isConditionalCheckFailure(error)) return;
      throw error;
    }
  };

  readonly listWatch = async (): Promise<Array<WatchEntryRecord>> => {
    if (this.props.reverseIndexName == null) {
      throw new Error("listWatch requires a reverseIndexName");
    }

    const items = await queryAll({
      dynamo: this.props.dynamo,
      input: {
        TableName: this.props.tableName,
        IndexName: this.props.reverseIndexName,
        KeyConditionExpression: "#sk = :sk AND begins_with(#pk, :pkPrefix)",
        ExpressionAttributeNames: { "#sk": "sk", "#pk": "pk" },
        ExpressionAttributeValues: { ":sk": watchConfigSk, ":pkPrefix": watchPkPrefix },
      },
    });

    return items.map((item) => this.parseWatchEntry(item));
  };

  readonly upsertWatch = async ({
    matcher,
    mode,
    source,
    status,
    label,
  }: {
    readonly matcher: string;
    readonly mode: WatchMode;
    readonly source: WatchSource;
    readonly status?: WatchStatus;
    readonly label?: string;
  }): Promise<void> => {
    const names: Record<string, string> = {
      "#matcher": "matcher",
      "#mode": "mode",
      "#source": "source",
      "#status": "status",
      "#firstSeen": "firstSeen",
    };
    const values: Record<string, unknown> = {
      ":matcher": matcher,
      ":mode": mode,
      ":source": source,
      ":status": status ?? "active",
      ":now": new Date().toISOString(),
    };
    const setParts = [
      "#matcher = :matcher",
      "#mode = :mode",
      "#source = :source",
      "#status = :status",
      "#firstSeen = if_not_exists(#firstSeen, :now)",
    ];

    if (label != null) {
      names["#label"] = "label";
      values[":label"] = label;
      setParts.push("#label = :label");
    }

    await this.props.dynamo.send(
      new UpdateCommand({
        TableName: this.props.tableName,
        Key: watchConfigKey({ matcher }),
        UpdateExpression: `SET ${setParts.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
  };

  /**
   * Flips an existing watch row's status. Guarded on both composite-key
   * attributes so it never creates a row for a matcher that was never watched;
   * a missing row is swallowed, mirroring {@link ensureStart}'s gentle handling
   * of a conditional miss rather than surfacing it to the caller.
   */
  readonly setWatchStatus = async ({
    matcher,
    status,
  }: {
    readonly matcher: string;
    readonly status: WatchStatus;
  }): Promise<void> => {
    try {
      await this.props.dynamo.send(
        new UpdateCommand({
          TableName: this.props.tableName,
          Key: watchConfigKey({ matcher }),
          UpdateExpression: "SET #status = :status",
          ConditionExpression: "attribute_exists(pk) AND attribute_exists(sk)",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":status": status },
        }),
      );
    } catch (error) {
      if (isConditionalCheckFailure(error)) return;
      throw error;
    }
  };

  readonly deleteWatch = async ({ matcher }: { readonly matcher: string }): Promise<void> => {
    await this.props.dynamo.send(
      new DeleteCommand({
        TableName: this.props.tableName,
        Key: watchConfigKey({ matcher }),
      }),
    );
  };

  private readonly parseWatchEntry = (item: unknown): WatchEntryRecord => {
    const result = v.safeParse(watchEntrySchema, item);
    if (!result.success) {
      console.error(v.flatten(result.issues));
      throw new Error("Malformed stored watch entry record");
    }
    return result.output;
  };
}
