import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

export class Setup {
  constructor(
    private readonly props: {
      readonly dynamo: Pick<DynamoDBDocumentClient, "send">;
      readonly tableName: string;
    },
  ) {}

  readonly isComplete = async (): Promise<boolean> => {
    const { Item: item } = await this.props.dynamo.send(
      new GetCommand({
        TableName: this.props.tableName,
        Key: { pk: "system#config", sk: "setup" },
      }),
    );

    return item != null;
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
