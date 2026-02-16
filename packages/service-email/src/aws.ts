import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export const dynamoClient: DynamoDBDocumentClient = DynamoDBDocumentClient.from(
  new DynamoDBClient(),
  {
    marshallOptions: {
      removeUndefinedValues: true,
      convertEmptyValues: false,
    },
  },
);

export const s3Client: S3Client = new S3Client();
