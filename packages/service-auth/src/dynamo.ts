import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { fromIni } from "@aws-sdk/credential-providers";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export const toDynamoClient = () => {
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
};
