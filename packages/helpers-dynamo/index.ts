import { DynamoDBClient, type KeysAndAttributes } from "@aws-sdk/client-dynamodb";
import { fromIni } from "@aws-sdk/credential-providers";
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  type NativeAttributeValue,
  QueryCommand,
  type QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { splitArrayToChunks } from "@beesolve/helpers";

export function toDynamoClient(): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(
    new DynamoDBClient({
      credentials: process.env.AWS_PROFILE
        ? fromIni({ profile: process.env.AWS_PROFILE })
        : undefined,
    }),
    {
      marshallOptions: {
        removeUndefinedValues: true,
        convertEmptyValues: false,
      },
    },
  );
}

/**
 * Returns all matching items by paginating through the query until DynamoDB
 * stops returning a `LastEvaluatedKey`.
 */
export async function queryAll(props: {
  input: QueryCommandInput;
  dynamo: Pick<DynamoDBDocumentClient, "send">;
}): Promise<Array<Record<string, unknown>>> {
  const items: Array<Record<string, unknown>> = [];
  let fromKey: Record<string, unknown> | undefined;

  do {
    const { Items = [], LastEvaluatedKey } = await props.dynamo.send(
      new QueryCommand({ ...props.input, ExclusiveStartKey: fromKey }),
    );
    fromKey = LastEvaluatedKey;

    items.push(...Items);
  } while (fromKey != null);

  return items;
}

/**
 * Helper for `BatchGetCommand` — supports only single-table batch get.
 *
 * - deduplicates keys
 * - splits keys into batches of 100
 * - maps retrieved data back to keys
 * - transforms data with the provided transformer
 */
export async function batchGet<K, T>(props: {
  keys: Array<K>;
  dynamo: Pick<DynamoDBDocumentClient, "send">;
  tableName: string;
  toInput: (batch: Array<K>) => Omit<KeysAndAttributes, "Keys"> & {
    Keys: Array<Record<string, NativeAttributeValue>>;
  };
  transform: (raw: Record<string, unknown>) => T;
}): Promise<Array<T>> {
  if (props.keys.length === 0) return [];
  const map = new Map<K, Record<string, unknown>>();

  const uniqueIds = Array.from(new Set(props.keys));
  await Promise.all(
    splitArrayToChunks(uniqueIds, 100).map(async (batch) => {
      const { Responses = {} } = await props.dynamo.send(
        new BatchGetCommand({
          RequestItems: {
            [props.tableName]: props.toInput(batch),
          },
        }),
      );
      const rows = Responses[props.tableName];
      if (rows == null) {
        throw new Error(`Unexpected error - no data returned for table "${props.tableName}".`);
      }

      rows.forEach((raw, index) => {
        const key = batch[index];
        if (key == null) return;
        map.set(key, raw);
      });
    }),
  );

  return props.keys.map((key) => {
    const raw = map.get(key);
    if (raw == null) {
      throw new Error(`Unexpected error - missing data for key ${JSON.stringify(key)}`);
    }
    return props.transform(raw);
  });
}
