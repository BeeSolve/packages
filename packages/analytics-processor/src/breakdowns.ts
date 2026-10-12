import type { DynamoDBDocumentClient, TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { queryAll } from "@beesolve/dynamo-helpers";
import * as v from "valibot";

import type { Dimension, Grain } from "./keys.ts";
import { dimensions, grains } from "./keys.ts";

type TransactWriteItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];
type UpdateMembers = NonNullable<TransactWriteItem["Update"]>;
interface TransactUpdateItem {
  readonly Update: UpdateMembers;
}

export interface BreakdownInput {
  readonly value: string;
  readonly hits: number;
  readonly bytes: number;
}

export const breakdownSchema = v.object({
  pk: v.string(),
  sk: v.string(),
  dimension: v.picklist(dimensions),
  grain: v.picklist(grains),
  periodKey: v.string(),
  value: v.string(),
  hits: v.number(),
  bytes: v.number(),
  ttl: v.optional(v.number()),
});
export type BreakdownItem = v.InferOutput<typeof breakdownSchema>;

export class Breakdowns {
  constructor(
    private readonly props: {
      readonly dynamo: Pick<DynamoDBDocumentClient, "send">;
      readonly tableName: string;
      readonly reverseIndexName?: string;
    },
  ) {}

  readonly addMany = async (props: {
    readonly dimension: Dimension;
    readonly grain: Grain;
    readonly periodKey: string;
    readonly items: Array<BreakdownInput>;
    readonly ttl?: number;
  }): Promise<void> => {
    const updates = this.buildUpdates(props);
    for (const update of updates) {
      await this.props.dynamo.send(new UpdateCommand(update.Update));
    }
  };

  readonly buildUpdates = (props: {
    readonly dimension: Dimension;
    readonly grain: Grain;
    readonly periodKey: string;
    readonly items: Array<BreakdownInput>;
    readonly ttl?: number;
  }): Array<TransactUpdateItem> =>
    props.items.map((item) => ({
      Update: this.buildUpdateMembers({
        dimension: props.dimension,
        grain: props.grain,
        periodKey: props.periodKey,
        item,
        ttl: props.ttl,
      }),
    }));

  readonly getForPeriod = async (props: {
    readonly dimension: Dimension;
    readonly grain: Grain;
    readonly periodKey: string;
  }): Promise<Array<BreakdownItem>> => {
    const items = await queryAll({
      dynamo: this.props.dynamo,
      input: {
        TableName: this.props.tableName,
        KeyConditionExpression: "#pk = :pk",
        ExpressionAttributeNames: { "#pk": "pk" },
        ExpressionAttributeValues: {
          ":pk": partitionKey({
            dimension: props.dimension,
            grain: props.grain,
            periodKey: props.periodKey,
          }),
        },
      },
    });

    return items.map((item) => this.parseOne(item));
  };

  private readonly buildUpdateMembers = (props: {
    readonly dimension: Dimension;
    readonly grain: Grain;
    readonly periodKey: string;
    readonly item: BreakdownInput;
    readonly ttl?: number;
  }): UpdateMembers => {
    const names: Record<string, string> = {
      "#dimension": "dimension",
      "#grain": "grain",
      "#periodKey": "periodKey",
      "#value": "value",
      "#hits": "hits",
      "#bytes": "bytes",
    };
    const values: Record<string, unknown> = {
      ":dimension": props.dimension,
      ":grain": props.grain,
      ":periodKey": props.periodKey,
      ":value": props.item.value,
      ":hits": props.item.hits,
      ":bytes": props.item.bytes,
    };

    const setParts = [
      "#dimension = :dimension",
      "#grain = :grain",
      "#periodKey = :periodKey",
      "#value = :value",
    ];

    if (props.ttl != null) {
      names["#ttl"] = "ttl";
      values[":ttl"] = props.ttl;
      setParts.push("#ttl = :ttl");
    }

    return {
      TableName: this.props.tableName,
      Key: {
        pk: partitionKey({
          dimension: props.dimension,
          grain: props.grain,
          periodKey: props.periodKey,
        }),
        sk: props.item.value,
      },
      UpdateExpression: `SET ${setParts.join(", ")} ADD #hits :hits, #bytes :bytes`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    };
  };

  private readonly parseOne = (item: unknown): BreakdownItem => {
    const result = v.safeParse(breakdownSchema, item);
    if (!result.success) {
      console.error(v.flatten(result.issues));
      throw new Error("Malformed stored breakdown record");
    }
    return result.output;
  };
}

function partitionKey(props: {
  readonly dimension: Dimension;
  readonly grain: Grain;
  readonly periodKey: string;
}): string {
  return `breakdown#${props.dimension}#${props.grain}#${props.periodKey}`;
}
