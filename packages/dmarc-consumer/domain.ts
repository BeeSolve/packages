import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

import type { DomainDns } from "./dnsRecord.ts";
import { domainDnsSchema } from "./dnsRecord.ts";

export const schema = v.object({
  pk: v.string(),
  sk: v.literal("domain"),
  domain: v.string(),
  totalMessages: v.number(),
  totalPass: v.number(),
  totalFail: v.number(),
  dns: v.optional(domainDnsSchema),
  selectors: v.optional(v.set(v.string())),
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
  }): Promise<{ readonly created: boolean }> => {
    const response = await this.props.dynamo.send(
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
        ReturnValues: "ALL_OLD",
      }),
    );

    return { created: response.Attributes == null };
  };

  readonly addSelectors = async (props: {
    readonly domain: string;
    readonly selectors: Array<string>;
  }): Promise<void> => {
    if (props.selectors.length === 0) return;

    await this.props.dynamo.send(
      new UpdateCommand({
        TableName: this.props.tableName,
        Key: { pk: `domain#${props.domain}`, sk: "domain" },
        UpdateExpression: "ADD #selectors :selectors",
        ExpressionAttributeNames: { "#selectors": "selectors" },
        ExpressionAttributeValues: { ":selectors": new Set(props.selectors) },
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

  readonly getByDomain = async (props: { readonly domain: string }): Promise<Domain | null> => {
    const { Item: item } = await this.props.dynamo.send(
      new GetCommand({
        TableName: this.props.tableName,
        Key: { pk: `domain#${props.domain}`, sk: "domain" },
      }),
    );

    if (item == null) return null;

    return this.parseOne(item);
  };

  readonly putDns = async (props: {
    readonly domain: string;
    readonly dns: DomainDns;
  }): Promise<void> => {
    await this.props.dynamo.send(
      new UpdateCommand({
        TableName: this.props.tableName,
        Key: { pk: `domain#${props.domain}`, sk: "domain" },
        UpdateExpression: "SET #dns = :dns",
        ExpressionAttributeNames: { "#dns": "dns" },
        ExpressionAttributeValues: { ":dns": props.dns },
      }),
    );
  };

  readonly clearDns = async (props: { readonly domain: string }): Promise<void> => {
    await this.props.dynamo.send(
      new UpdateCommand({
        TableName: this.props.tableName,
        Key: { pk: `domain#${props.domain}`, sk: "domain" },
        UpdateExpression: "REMOVE #dns",
        ExpressionAttributeNames: { "#dns": "dns" },
      }),
    );
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
