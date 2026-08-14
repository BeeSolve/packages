import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

export const schema = v.object({
  pk: v.string(),
  sk: v.literal("domain"),
  domain: v.string(),
  totalMessages: v.number(),
  totalPass: v.number(),
  totalFail: v.number(),
});

export type Domain = v.InferOutput<typeof schema>;

export class Domains {
  constructor(
    private readonly props: {
      readonly dynamo: Pick<DynamoDBDocumentClient, "send">;
      readonly tableName: string;
      readonly reverseIndexName: string;
    },
  ) {}

  readonly upsert = async (props: {
    readonly domain: string;
    readonly totalMessages: number;
    readonly totalPass: number;
    readonly totalFail: number;
  }): Promise<void> => {
    await this.props.dynamo.send(
      new UpdateCommand({
        TableName: this.props.tableName,
        Key: { pk: `domain#${props.domain}`, sk: "domain" },
        UpdateExpression:
          "SET #domain = :domain ADD #totalMessages :msgs, #totalPass :pass, #totalFail :fail",
        ExpressionAttributeNames: {
          "#domain": "domain",
          "#totalMessages": "totalMessages",
          "#totalPass": "totalPass",
          "#totalFail": "totalFail",
        },
        ExpressionAttributeValues: {
          ":domain": props.domain,
          ":msgs": props.totalMessages,
          ":pass": props.totalPass,
          ":fail": props.totalFail,
        },
      }),
    );
  };

  readonly list = async (): Promise<Array<Domain>> => {
    const { Items: items = [] } = await this.props.dynamo.send(
      new QueryCommand({
        TableName: this.props.tableName,
        IndexName: this.props.reverseIndexName,
        KeyConditionExpression: "#pk = :pk",
        ExpressionAttributeNames: { "#pk": "sk" },
        ExpressionAttributeValues: { ":pk": "domain" },
      }),
    );

    return items.map((item) => this.parseOne(item));
  };

  private readonly parseOne = (item: unknown): Domain => {
    const result = v.safeParse(schema, item);
    if (!result.success) {
      console.error(v.flatten(result.issues));
      throw new Error("Malformed stored domain record");
    }
    return result.output;
  };
}
