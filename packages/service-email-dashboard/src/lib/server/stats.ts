import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

import type { Stats } from "./schema";
import { statsSchema } from "./schema";

export class GlobalStats {
  constructor(
    private readonly props: {
      readonly dynamo: Pick<DynamoDBDocumentClient, "send">;
      readonly tableName: string;
    },
  ) {}

  readonly get = async () => {
    const { Item: item } = await this.props.dynamo.send(
      new GetCommand({
        TableName: this.props.tableName,
        Key: { pk: "stats", sk: "global" },
      }),
    );

    return this.toModel(item == null ? null : v.parse(statsSchema, item));
  };

  readonly addFailure = async (): Promise<void> => {
    await this.props.dynamo.send(
      new UpdateCommand({
        TableName: this.props.tableName,
        Key: { pk: "stats" as const, sk: "global" as const },
        UpdateExpression: "ADD #counter :one",
        ExpressionAttributeNames: { "#counter": "failed" },
        ExpressionAttributeValues: { ":one": 1 },
      }),
    );
  };

  private readonly toModel = (value: Stats | null) => {
    const item = {
      received: value?.received ?? 0,
      sent: value?.sent ?? 0,
      delivered: value?.delivered ?? 0,
      bounced: value?.bounced ?? 0,
      complained: value?.complained ?? 0,
      rejected: value?.rejected ?? 0,
      failed: value?.failed ?? 0,
    };

    return {
      ...item,
      total: Object.values(item).reduce((result, current) => (result += current), 0),
    };
  };
}
