import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

import type { Recipient } from "./schema";
import { decodeCursor, defaultLimit, encodeCursor, recipientSchema } from "./schema";

export class Recipients {
  constructor(
    private readonly props: {
      readonly dynamo: Pick<DynamoDBDocumentClient, "send">;
      readonly tableName: string;
      readonly reverseIndexName: string;
    },
  ) {}

  readonly list = async ({
    limit = defaultLimit,
    cursor,
  }: {
    readonly limit?: number;
    readonly cursor?: string;
  } = {}): Promise<{ items: Array<Recipient>; cursor?: string }> => {
    const { Items: items = [], LastEvaluatedKey: lastKey } = await this.props.dynamo.send(
      new QueryCommand({
        TableName: this.props.tableName,
        IndexName: this.props.reverseIndexName,
        KeyConditionExpression: "#sk = :sk",
        ExpressionAttributeNames: { "#sk": "sk" },
        ExpressionAttributeValues: { ":sk": "recipient" },
        Limit: limit,
        ExclusiveStartKey: decodeCursor(cursor),
      }),
    );

    return {
      items: items.map((raw) => v.parse(recipientSchema, raw)),
      cursor: encodeCursor(lastKey),
    };
  };

  readonly listEmails = async (): Promise<Array<string>> => {
    const emails: Array<string> = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const { Items: items = [], LastEvaluatedKey: lastKey } = await this.props.dynamo.send(
        new QueryCommand({
          TableName: this.props.tableName,
          IndexName: this.props.reverseIndexName,
          KeyConditionExpression: "#sk = :sk",
          ExpressionAttributeNames: { "#sk": "sk", "#pk": "pk" },
          ExpressionAttributeValues: { ":sk": "recipient" },
          ProjectionExpression: "#pk",
          ExclusiveStartKey: startKey,
        }),
      );
      for (const rawRecipient of items) {
        if (typeof rawRecipient.pk === "string") emails.push(rawRecipient.pk);
      }
      startKey = lastKey;
    } while (startKey != null);
    return emails.sort();
  };

  readonly getStats = async ({ email }: { readonly email: string }) => {
    const normalizedEmail = email.trim().toLowerCase();

    const { Item: item } = await this.props.dynamo.send(
      new GetCommand({
        TableName: this.props.tableName,
        Key: { pk: normalizedEmail, sk: "recipient" },
      }),
    );

    const raw = item == null ? null : v.parse(recipientSchema, item);

    return {
      stats: this.toModel(raw),
      email: normalizedEmail,
    };
  };

  private readonly toModel = (value: Recipient | null) => {
    return {
      received: value?.received ?? 0,
      sent: value?.sent ?? 0,
      delivered: value?.delivered ?? 0,
      bounced: value?.bounced ?? 0,
      complained: value?.complained ?? 0,
      rejected: value?.rejected ?? 0,
      failed: value?.failed ?? 0,
    };
  };
}
