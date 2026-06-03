import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

import { BadRequestError, NotFoundError } from "./errors.ts";
import { dateSchema } from "./validation.ts";

const accountTypes = ["email", "phone", "passkey"] as const;
type AccountType = (typeof accountTypes)[number];

const schema = v.object({
  id: v.string(),
  username: v.string(),
  type: v.picklist(accountTypes),
  createdAt: dateSchema,
  updatedAt: dateSchema,
});

type NewAccount = v.InferInput<typeof schema>;
type Account = v.InferOutput<typeof schema>;

export class Accounts {
  constructor(
    private readonly props: {
      readonly dynamo: Pick<DynamoDBDocumentClient, "send">;
      readonly tableName: string;
      readonly reverseIndexName: string;
    },
  ) {}

  readonly getOne = async (username: string) => {
    const { Items: items = [] } = await this.props.dynamo.send(
      new QueryCommand({
        TableName: this.props.tableName,
        IndexName: this.props.reverseIndexName,
        KeyConditionExpression: `#username = :username`,
        ExpressionAttributeNames: {
          "#username": "username",
        },
        ExpressionAttributeValues: {
          ":username": username.toLowerCase(),
        },
      }),
    );

    if (items.length === 0) throw new NotFoundError(`Account does not exist.`);
    if (items.length !== 1) throw new Error(`Unexpected - found more than one accounts.`);

    const result = this.parseOne(items[0]);

    return this.toModel(result);
  };

  readonly getMany = async (userId: string) => {
    const { Items: items = [] } = await this.props.dynamo.send(
      new QueryCommand({
        TableName: this.props.tableName,
        KeyConditionExpression: "#id = :id",
        ExpressionAttributeNames: {
          "#id": "id",
        },
        ExpressionAttributeValues: {
          ":id": userId,
        },
      }),
    );

    return items.map((item) => {
      const parsed = this.parseOne(item);

      return this.toModel(parsed);
    });
  };

  readonly createNew = async (props: {
    readonly id: string;
    readonly username: string;
    readonly type: AccountType;
  }) => {
    const createdAt = new Date().toISOString();

    const item: NewAccount = {
      id: props.id,
      username: props.username.toLowerCase(),
      type: props.type,
      createdAt,
      updatedAt: createdAt,
    };
    const result = this.parseOne(
      item,
      "Unexpected error occurred while creating account. Account has not been created.",
    );

    await this.props.dynamo
      .send(
        new PutCommand({
          TableName: this.props.tableName,
          Item: item,
          ConditionExpression: "attribute_not_exists(#put_username)",
          ExpressionAttributeNames: {
            "#put_username": "username",
          },
        }),
      )
      .catch((error) => {
        if (error instanceof ConditionalCheckFailedException)
          throw new BadRequestError(`Username already exists.`);

        throw error;
      });

    return this.toModel(result);
  };

  private readonly parseOne = (item: any, errorMessage: string = `Malformed account.`) => {
    const result = v.safeParse(schema, item);
    if (!result.success) {
      console.error(v.flatten(result.issues));
      throw new BadRequestError(errorMessage);
    }

    return result.output;
  };

  private readonly toModel = (value: Account) => {
    return {
      id: value.id,
      username: value.username,
      type: value.type,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    };
  };
}
