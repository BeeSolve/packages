import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { queryAll } from "@beesolve/dynamo-helpers";
import * as v from "valibot";

import { BadRequestError, NotFoundError } from "./errors.ts";
import { dateSchema } from "./validation.ts";

export type Account = v.InferOutput<typeof schema>;
export type PasskeyAccount = v.InferOutput<typeof passkeyAccountSchema>;

const baseFields = {
  id: v.string(),
  createdAt: dateSchema,
  updatedAt: dateSchema,
};

const emailAccountSchema = v.object({
  ...baseFields,
  type: v.literal("email"),
  username: v.string(),
});

const phoneAccountSchema = v.object({
  ...baseFields,
  type: v.literal("phone"),
  username: v.string(),
});

const passkeyAccountSchema = v.object({
  ...baseFields,
  type: v.literal("passkey"),
  username: v.string(),
  publicKey: v.string(),
  counter: v.number(),
  transports: v.array(v.string()),
  aaguid: v.string(),
  backedUp: v.boolean(),
  algorithm: v.number(),
});

const schema = v.variant("type", [emailAccountSchema, phoneAccountSchema, passkeyAccountSchema]);

export class Accounts {
  constructor(
    private readonly props: {
      readonly dynamo: Pick<DynamoDBDocumentClient, "send">;
      readonly tableName: string;
      readonly reverseIndexName: string;
    },
  ) {}

  readonly getOne = async ({
    username,
    exact = false,
  }: {
    readonly username: string;
    readonly exact?: boolean;
  }) => {
    const { Items: items = [] } = await this.props.dynamo.send(
      new QueryCommand({
        TableName: this.props.tableName,
        IndexName: this.props.reverseIndexName,
        KeyConditionExpression: `#username = :username`,
        ExpressionAttributeNames: {
          "#username": "username",
        },
        ExpressionAttributeValues: {
          ":username": exact ? username : username.toLowerCase(),
        },
      }),
    );

    if (items.length === 0) throw new NotFoundError(`Account does not exist.`);
    if (items.length !== 1) throw new Error(`Unexpected - found more than one accounts.`);

    const result = this.parseOne(items[0]);

    return this.toModel(result);
  };

  readonly getMany = async (userId: string) => {
    const items = await queryAll({
      dynamo: this.props.dynamo,
      input: {
        TableName: this.props.tableName,
        KeyConditionExpression: "#id = :id",
        ExpressionAttributeNames: {
          "#id": "id",
        },
        ExpressionAttributeValues: {
          ":id": userId,
        },
      },
    });

    return items.map((item) => {
      const parsed = this.parseOne(item);

      return this.toModel(parsed);
    });
  };

  readonly createNew = async (props: {
    readonly id: string;
    readonly username: string;
    readonly type: "email" | "phone";
  }) => {
    const createdAt = new Date().toISOString();

    const item = {
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

  readonly createPasskey = async (props: {
    readonly id: string;
    readonly credentialId: string;
    readonly publicKey: string;
    readonly counter: number;
    readonly transports: Array<string>;
    readonly aaguid: string;
    readonly backedUp: boolean;
    readonly algorithm: number;
  }) => {
    const createdAt = new Date().toISOString();

    const item: v.InferInput<typeof passkeyAccountSchema> = {
      id: props.id,
      username: props.credentialId,
      type: "passkey",
      publicKey: props.publicKey,
      counter: props.counter,
      transports: props.transports,
      aaguid: props.aaguid,
      backedUp: props.backedUp,
      algorithm: props.algorithm,
      createdAt,
      updatedAt: createdAt,
    };
    const result = this.parseOne(
      item,
      "Unexpected error occurred while creating passkey account. Account has not been created.",
    );

    await this.props.dynamo
      .send(
        new PutCommand({
          TableName: this.props.tableName,
          Item: item,
          ConditionExpression: "attribute_not_exists(#id) AND attribute_not_exists(#username)",
          ExpressionAttributeNames: {
            "#id": "id",
            "#username": "username",
          },
        }),
      )
      .catch((error) => {
        if (error instanceof ConditionalCheckFailedException)
          throw new BadRequestError(`Passkey credential already exists.`);

        throw error;
      });

    return this.toModel(result);
  };

  readonly updateCounter = async (props: {
    readonly userId: string;
    readonly credentialId: string;
    readonly counter: number;
  }) => {
    await this.props.dynamo.send(
      new UpdateCommand({
        TableName: this.props.tableName,
        Key: {
          id: props.userId,
          username: props.credentialId,
        },
        UpdateExpression: "SET #counter = :counter, #updatedAt = :updatedAt",
        ExpressionAttributeNames: {
          "#counter": "counter",
          "#updatedAt": "updatedAt",
        },
        ExpressionAttributeValues: {
          ":counter": props.counter,
          ":updatedAt": new Date().toISOString(),
        },
      }),
    );
  };

  readonly getPasskeysByUserId = async (userId: string): Promise<Array<PasskeyAccount>> => {
    const accounts = await this.getMany(userId);

    return accounts.filter((account): account is PasskeyAccount => account.type === "passkey");
  };

  private readonly parseOne = (item: unknown, errorMessage: string = `Malformed account.`) => {
    const result = v.safeParse(schema, item);
    if (!result.success) {
      console.error(v.flatten(result.issues));
      throw new BadRequestError(errorMessage);
    }

    return result.output;
  };

  private readonly toModel = (value: Account): Account => {
    if (value.type === "passkey") {
      return {
        id: value.id,
        username: value.username,
        type: value.type,
        publicKey: value.publicKey,
        counter: value.counter,
        transports: value.transports,
        aaguid: value.aaguid,
        backedUp: value.backedUp,
        algorithm: value.algorithm,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
      };
    }

    return {
      id: value.id,
      username: value.username,
      type: value.type,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    };
  };
}
