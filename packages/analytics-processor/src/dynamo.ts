import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export function toDynamoClient(): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(new DynamoDBClient(), {
    marshallOptions: {
      removeUndefinedValues: true,
      convertEmptyValues: false,
    },
  });
}
