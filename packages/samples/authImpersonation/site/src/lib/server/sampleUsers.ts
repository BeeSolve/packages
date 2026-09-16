import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

export const schema = v.object({
  pk: v.string(),
  sk: v.literal("user"),
  email: v.string(),
  userId: v.string(),
  createdAt: v.string(),
});

export type SampleUser = v.InferOutput<typeof schema>;

export class SampleUsers {
  constructor(
    private readonly props: {
      readonly dynamo: Pick<DynamoDBDocumentClient, "send">;
      readonly tableName: string;
      readonly reverseIndexName: string;
    },
  ) {}

  readonly upsert = async ({
    email,
    userId,
  }: {
    readonly email: string;
    readonly userId: string;
  }): Promise<void> => {
    try {
      await this.props.dynamo.send(
        new PutCommand({
          TableName: this.props.tableName,
          Item: {
            pk: `user#${email}`,
            sk: "user",
            email,
            userId,
            createdAt: new Date().toISOString(),
          },
          ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
        return;
      }
      throw error;
    }
  };

  readonly listAll = async (): Promise<Array<SampleUser>> => {
    const { Items: items } = await this.props.dynamo.send(
      new QueryCommand({
        TableName: this.props.tableName,
        IndexName: this.props.reverseIndexName,
        KeyConditionExpression: "#sk = :sk",
        ExpressionAttributeNames: { "#sk": "sk" },
        ExpressionAttributeValues: { ":sk": "user" },
      }),
    );

    if (items == null) return [];
    return items.map((item) => this.parseOne(item));
  };

  private readonly parseOne = (item: unknown): SampleUser => {
    const result = v.safeParse(schema, item);
    if (!result.success) {
      console.error(v.flatten(result.issues));
      throw new Error("Malformed stored user record");
    }
    return result.output;
  };
}
