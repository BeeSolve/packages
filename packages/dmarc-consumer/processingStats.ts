import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

export const processingStatsSchema = v.object({
  pk: v.literal("stats#daily"),
  sk: v.string(),
  processed: v.optional(v.number(), 0),
  manualUpload: v.optional(v.number(), 0),
  authRejected: v.optional(v.number(), 0),
  spamRejected: v.optional(v.number(), 0),
  virusRejected: v.optional(v.number(), 0),
});

export type ProcessingStatsItem = v.InferOutput<typeof processingStatsSchema>;

const counterFields = [
  "processed",
  "manualUpload",
  "authRejected",
  "spamRejected",
  "virusRejected",
] as const;

export type StatsCounter = (typeof counterFields)[number];

export class ProcessingStats {
  constructor(
    private readonly props: {
      readonly dynamo: Pick<DynamoDBDocumentClient, "send">;
      readonly tableName: string;
    },
  ) {}

  readonly increment = async (props: {
    readonly counter: StatsCounter;
    readonly value?: number;
    readonly date?: string;
  }): Promise<void> => {
    const date = props.date ?? todayUtc();
    const incrementValue = props.value ?? 1;

    await this.props.dynamo.send(
      new UpdateCommand({
        TableName: this.props.tableName,
        Key: { pk: "stats#daily", sk: date },
        UpdateExpression: "ADD #counter :val",
        ExpressionAttributeNames: { "#counter": props.counter },
        ExpressionAttributeValues: { ":val": incrementValue },
      }),
    );
  };

  readonly queryRange = async (props: {
    readonly startDate: string;
    readonly endDate: string;
  }): Promise<Array<ProcessingStatsItem>> => {
    const { Items: items = [] } = await this.props.dynamo.send(
      new QueryCommand({
        TableName: this.props.tableName,
        KeyConditionExpression: "#pk = :pk AND #sk BETWEEN :start AND :end",
        ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
        ExpressionAttributeValues: {
          ":pk": "stats#daily",
          ":start": props.startDate,
          ":end": props.endDate,
        },
      }),
    );

    return items.map((item) => this.parseOne(item));
  };

  private readonly parseOne = (item: unknown): ProcessingStatsItem => {
    const result = v.safeParse(processingStatsSchema, item);
    if (!result.success) {
      console.error(v.flatten(result.issues));
      throw new Error("Malformed stored processing stats record");
    }
    return result.output;
  };
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}
