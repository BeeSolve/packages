import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { fromIni } from "@aws-sdk/credential-providers";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";
import { ActionTokens } from "./model.ts";

const message = `It seems that ActionTokens has not been set up correctly. Please make sure you've used official CDK construct and that you've granted access to your lambda function.`;
const envSchema = v.object({
  BEESOLVE_ACTION_TOKENS_TABLE_NAME: v.config(v.string(), { message }),
  BEESOLVE_ACTION_TOKENS_INDEX_NAME: v.config(v.string(), { message }),
});
const env = v.parse(envSchema, process.env);

export class ActionTokensClient {
  private readonly model: ActionTokens;

  constructor(props: { dynamoDbClient?: DynamoDBDocumentClient } = {}) {
    this.model = new ActionTokens({
      dynamo: props.dynamoDbClient ?? toDynamoClient(),
      tableName: env.BEESOLVE_ACTION_TOKENS_TABLE_NAME,
      valueIndexName: env.BEESOLVE_ACTION_TOKENS_INDEX_NAME,
    });
  }

  readonly createNew = (props: {
    readonly owner: string;
    readonly action: string;
    readonly value: string;
    readonly remainingUses: number;
    readonly expiresAt: Date;
    readonly data: Record<string, unknown> | undefined;
    readonly overwrite: boolean;
  }) => this.model.createNew(props);

  readonly use = (props: {
    readonly owner: string | undefined;
    readonly action: string;
    readonly value: string;
    readonly drainWhenValid: boolean;
  }) => this.model.use(props);

  readonly drain = (props: {
    readonly owner: string;
    readonly action: string;
  }) => this.model.drain(props);
}

const toDynamoClient = () => {
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
