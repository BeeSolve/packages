import type { DynamoDBDocumentClient, TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { queryAll } from "@beesolve/dynamo-helpers";
import * as v from "valibot";

import type { Grain } from "./keys.ts";
import { grains } from "./keys.ts";

type TransactWriteItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];
type UpdateMembers = NonNullable<TransactWriteItem["Update"]>;
interface TransactUpdateItem {
  readonly Update: UpdateMembers;
}

export interface TotalsInput {
  readonly timeKey: string;
  readonly hits: number;
  readonly success: number;
  readonly errors: number;
  readonly errors4xx: number;
  readonly errors5xx: number;
  readonly bytesSent: number;
  readonly bytesReceived: number;
  readonly p50TimeTaken?: number;
  readonly p95TimeTaken?: number;
  readonly cacheHitRatio?: number;
  readonly uniqueIpCount?: number;
}

const additiveFields = [
  "hits",
  "success",
  "errors",
  "errors4xx",
  "errors5xx",
  "bytesSent",
  "bytesReceived",
] as const;

const hourlyDetailFields = [
  "p50TimeTaken",
  "p95TimeTaken",
  "cacheHitRatio",
  "uniqueIpCount",
] as const;

export const totalsSchema = v.object({
  pk: v.string(),
  sk: v.string(),
  grain: v.picklist(grains),
  timeKey: v.string(),
  hits: v.number(),
  success: v.number(),
  errors: v.number(),
  errors4xx: v.number(),
  errors5xx: v.number(),
  bytesSent: v.number(),
  bytesReceived: v.number(),
  p50TimeTaken: v.optional(v.number()),
  p95TimeTaken: v.optional(v.number()),
  cacheHitRatio: v.optional(v.number()),
  uniqueIpCount: v.optional(v.number()),
  ttl: v.optional(v.number()),
});
export type TotalsItem = v.InferOutput<typeof totalsSchema>;

export class Totals {
  constructor(
    private readonly props: {
      readonly dynamo: Pick<DynamoDBDocumentClient, "send">;
      readonly tableName: string;
      readonly reverseIndexName?: string;
    },
  ) {}

  readonly addHourly = async (props: {
    readonly item: TotalsInput;
    readonly ttl: number;
  }): Promise<void> => {
    const update = this.buildHourlyUpdate(props);
    await this.props.dynamo.send(new UpdateCommand(update.Update));
  };

  readonly addAggregate = async (props: {
    readonly grain: "day" | "month";
    readonly item: TotalsInput;
  }): Promise<void> => {
    const update = this.buildAggregateUpdate(props);
    await this.props.dynamo.send(new UpdateCommand(update.Update));
  };

  readonly buildHourlyUpdate = (props: {
    readonly item: TotalsInput;
    readonly ttl: number;
  }): TransactUpdateItem => ({
    Update: this.buildUpdateMembers({
      grain: "hour",
      item: props.item,
      ttl: props.ttl,
      includeHourlyDetail: true,
    }),
  });

  readonly buildAggregateUpdate = (props: {
    readonly grain: "day" | "month";
    readonly item: TotalsInput;
  }): TransactUpdateItem => ({
    Update: this.buildUpdateMembers({
      grain: props.grain,
      item: props.item,
      includeHourlyDetail: false,
    }),
  });

  readonly queryWindow = async (props: {
    readonly grain: Grain;
    readonly startKey: string;
    readonly endKey: string;
  }): Promise<Array<TotalsItem>> => {
    const items = await queryAll({
      dynamo: this.props.dynamo,
      input: {
        TableName: this.props.tableName,
        KeyConditionExpression: "#pk = :pk AND #sk BETWEEN :start AND :end",
        ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
        ExpressionAttributeValues: {
          ":pk": partitionKey(props.grain),
          ":start": props.startKey,
          ":end": props.endKey,
        },
      },
    });

    return items.map((item) => this.parseOne(item));
  };

  readonly getOne = async (props: {
    readonly grain: Grain;
    readonly timeKey: string;
  }): Promise<TotalsItem | undefined> => {
    const { Item: item } = await this.props.dynamo.send(
      new GetCommand({
        TableName: this.props.tableName,
        Key: { pk: partitionKey(props.grain), sk: props.timeKey },
      }),
    );

    if (item == null) return undefined;
    return this.parseOne(item);
  };

  private readonly buildUpdateMembers = (props: {
    readonly grain: Grain;
    readonly item: TotalsInput;
    readonly ttl?: number;
    readonly includeHourlyDetail: boolean;
  }): UpdateMembers => {
    const names: Record<string, string> = { "#grain": "grain", "#timeKey": "timeKey" };
    const values: Record<string, unknown> = {
      ":grain": props.grain,
      ":timeKey": props.item.timeKey,
    };

    const setParts = ["#grain = :grain", "#timeKey = :timeKey"];
    const addParts: Array<string> = [];

    for (const field of additiveFields) {
      names[`#${field}`] = field;
      values[`:${field}`] = props.item[field];
      addParts.push(`#${field} :${field}`);
    }

    if (props.includeHourlyDetail) {
      for (const field of hourlyDetailFields) {
        const value = props.item[field];
        if (value == null) continue;
        names[`#${field}`] = field;
        values[`:${field}`] = value;
        setParts.push(`#${field} = :${field}`);
      }
    }

    if (props.ttl != null) {
      names["#ttl"] = "ttl";
      values[":ttl"] = props.ttl;
      setParts.push("#ttl = :ttl");
    }

    return {
      TableName: this.props.tableName,
      Key: { pk: partitionKey(props.grain), sk: props.item.timeKey },
      UpdateExpression: `SET ${setParts.join(", ")} ADD ${addParts.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    };
  };

  private readonly parseOne = (item: unknown): TotalsItem => {
    const result = v.safeParse(totalsSchema, item);
    if (!result.success) {
      console.error(v.flatten(result.issues));
      throw new Error("Malformed stored totals record");
    }
    return result.output;
  };
}

function partitionKey(grain: Grain): string {
  return `totals#${grain}`;
}
