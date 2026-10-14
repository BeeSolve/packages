import type { DynamoDBDocumentClient, TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

import type { AppliedSource, Grain } from "./keys.ts";
import { appliedSources } from "./keys.ts";

export type MarkerGrain = Grain | "sitemap";

type TransactWriteItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];
type PutMembers = NonNullable<TransactWriteItem["Put"]>;
interface TransactPutItem {
  readonly Put: PutMembers;
}

export const appliedMarkerSchema = v.object({
  pk: v.string(),
  sk: v.string(),
  source: v.picklist(appliedSources),
  appliedAt: v.number(),
  ttl: v.optional(v.number()),
});
export type AppliedMarker = v.InferOutput<typeof appliedMarkerSchema>;

export class AppliedMarkers {
  constructor(
    private readonly props: {
      readonly dynamo: Pick<DynamoDBDocumentClient, "send">;
      readonly tableName: string;
      readonly reverseIndexName?: string;
    },
  ) {}

  readonly isApplied = async (props: {
    readonly grain: MarkerGrain;
    readonly periodKey: string;
  }): Promise<boolean> => {
    const { Item: item } = await this.props.dynamo.send(
      new GetCommand({
        TableName: this.props.tableName,
        Key: { pk: partitionKey(props), sk: "applied" },
      }),
    );

    return item != null;
  };

  readonly buildMarkerPut = (props: {
    readonly grain: MarkerGrain;
    readonly periodKey: string;
    readonly source: AppliedSource;
    readonly ttl?: number;
  }): TransactPutItem => {
    const item: NonNullable<PutMembers["Item"]> = {
      pk: partitionKey(props),
      sk: "applied",
      source: props.source,
      appliedAt: Date.now(),
    };

    if (props.ttl != null) {
      item.ttl = props.ttl;
    }

    return {
      Put: {
        TableName: this.props.tableName,
        Item: item,
        ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
      },
    };
  };
}

function partitionKey(props: { readonly grain: MarkerGrain; readonly periodKey: string }): string {
  return `applied#${props.grain}#${props.periodKey}`;
}
