import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

export const configSchema = v.object({
  pk: v.literal("system#config"),
  sk: v.literal("analytics"),
  startKey: v.string(),
  startedAt: v.string(),
});
export type AnalyticsConfig = v.InferOutput<typeof configSchema>;

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
    },
  ) {}

  readonly get = async (): Promise<AnalyticsConfig | null> => {
    const { Item: item } = await this.props.dynamo.send(
      new GetCommand({ TableName: this.props.tableName, Key: configKey }),
    );
    if (item == null) return null;
    return v.parse(configSchema, item);
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
}
