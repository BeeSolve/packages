import type { DynamoDBDocumentClient, TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

import type { Grain, Tier } from "./keys.ts";
import { defaultTier, tierMarkerSegment } from "./keys.ts";

export type MarkerGrain = Grain | "sitemap" | "watch";

type TransactWriteItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];
type PutMembers = NonNullable<TransactWriteItem["Put"]>;
interface TransactPutItem {
  readonly Put: PutMembers;
}

/**
 * An applied-marker is a presence check: its existence means a period has been
 * processed. `looseObject` tolerates the legacy `source` attribute that older
 * markers still carry (it is never read) without requiring new markers to write
 * it.
 */
export const appliedMarkerSchema = v.looseObject({
  pk: v.string(),
  sk: v.string(),
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
    readonly tier?: Tier;
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
    readonly ttl?: number;
    readonly tier?: Tier;
  }): TransactPutItem => {
    const item: NonNullable<PutMembers["Item"]> = {
      pk: partitionKey(props),
      sk: "applied",
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

function partitionKey(props: {
  readonly grain: MarkerGrain;
  readonly periodKey: string;
  readonly tier?: Tier;
}): string {
  return `applied#${tierMarkerSegment(props.tier ?? defaultTier)}${props.grain}#${props.periodKey}`;
}
