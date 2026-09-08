import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

import type { SetupConfig } from "./schema";
import { setupSchema } from "./schema";

export class Setup {
  constructor(
    private readonly props: {
      readonly dynamo: Pick<DynamoDBDocumentClient, "send">;
      readonly tableName: string;
    },
  ) {}

  readonly get = async (): Promise<SetupConfig | null> => {
    const { Item: item } = await this.props.dynamo.send(
      new GetCommand({
        TableName: this.props.tableName,
        Key: { pk: "system#config", sk: "setup" },
      }),
    );

    return item == null ? null : v.parse(setupSchema, item);
  };

  readonly markComplete = async ({
    adminEmail,
  }: {
    readonly adminEmail: string;
  }): Promise<void> => {
    await this.props.dynamo.send(
      new PutCommand({
        TableName: this.props.tableName,
        Item: {
          pk: "system#config",
          sk: "setup",
          completedAt: new Date().toISOString(),
          adminEmail,
        },
        ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
      }),
    );
  };
}
