import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { queryAll } from "@beesolve/dynamo-helpers";
import * as v from "valibot";

export const urlDirectorySk = "url";

export const urlDirectorySchema = v.looseObject({
  pk: v.string(),
  sk: v.literal(urlDirectorySk),
  firstSeen: v.string(),
});
export type UrlDirectoryRecord = v.InferOutput<typeof urlDirectorySchema>;

export class UrlDirectory {
  constructor(
    private readonly props: {
      readonly dynamo: Pick<DynamoDBDocumentClient, "send">;
      readonly tableName: string;
      readonly reverseIndexName?: string;
    },
  ) {}

  /**
   * Record each URL in the metric-free catalog, stamping `firstSeen` with the
   * given day only the first time a URL appears. Repeat writes are blind,
   * idempotent `if_not_exists` upserts — one update per URL, acceptable at the
   * daily cadence this is called on.
   */
  readonly upsertManyFirstSeen = async ({
    urls,
    day,
  }: {
    readonly urls: Array<string>;
    readonly day: string;
  }): Promise<void> => {
    for (const url of urls) {
      await this.props.dynamo.send(new UpdateCommand(this.buildFirstSeenUpdate({ url, day })));
    }
  };

  readonly listUrls = async (): Promise<Array<{ url: string; firstSeen: string }>> => {
    if (this.props.reverseIndexName == null) {
      throw new Error("listUrls requires a reverseIndexName");
    }

    const items = await queryAll({
      dynamo: this.props.dynamo,
      input: {
        TableName: this.props.tableName,
        IndexName: this.props.reverseIndexName,
        KeyConditionExpression: "#sk = :sk",
        ExpressionAttributeNames: { "#sk": "sk" },
        ExpressionAttributeValues: { ":sk": urlDirectorySk },
      },
    });

    return items.map((item) => {
      const record = this.parseOne(item);
      return { url: record.pk, firstSeen: record.firstSeen };
    });
  };

  private readonly buildFirstSeenUpdate = ({
    url,
    day,
  }: {
    readonly url: string;
    readonly day: string;
  }) => ({
    TableName: this.props.tableName,
    Key: { pk: url, sk: urlDirectorySk },
    UpdateExpression: "SET #firstSeen = if_not_exists(#firstSeen, :day)",
    ExpressionAttributeNames: { "#firstSeen": "firstSeen" },
    ExpressionAttributeValues: { ":day": day },
  });

  private readonly parseOne = (item: unknown): UrlDirectoryRecord => {
    const result = v.safeParse(urlDirectorySchema, item);
    if (!result.success) {
      console.error(v.flatten(result.issues));
      throw new Error("Malformed stored url directory record");
    }
    return result.output;
  };
}
