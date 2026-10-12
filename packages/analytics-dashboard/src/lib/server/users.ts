import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

export const userTypes = ["admin", "user"] as const;
export type UserType = (typeof userTypes)[number];

export const schema = v.object({
  pk: v.string(),
  sk: v.literal("user"),
  email: v.string(),
  type: v.picklist(userTypes),
  domains: v.array(v.string()),
  createdAt: v.string(),
});

export type User = v.InferOutput<typeof schema>;

export class Users {
  constructor(
    private readonly props: {
      readonly dynamo: Pick<DynamoDBDocumentClient, "send">;
      readonly tableName: string;
      readonly reverseIndexName: string;
    },
  ) {}

  readonly getByEmail = async ({ email }: { readonly email: string }): Promise<User> => {
    const { Item: item } = await this.props.dynamo.send(
      new GetCommand({
        TableName: this.props.tableName,
        Key: { pk: `user#${email}`, sk: "user" },
      }),
    );

    if (item == null) {
      throw new UserNotFoundError(email);
    }

    return this.parseOne(item);
  };

  readonly create = async ({
    email,
    type,
    domains,
  }: {
    readonly email: string;
    readonly type: UserType;
    readonly domains: Array<string>;
  }): Promise<void> => {
    const now = new Date().toISOString();

    try {
      await this.props.dynamo.send(
        new PutCommand({
          TableName: this.props.tableName,
          Item: { pk: `user#${email}`, sk: "user", email, type, domains, createdAt: now },
          ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
        throw new UserAlreadyExistsError(email);
      }
      throw error;
    }
  };

  readonly hasAnyUsers = async (): Promise<boolean> => {
    const { Items: items } = await this.props.dynamo.send(
      new QueryCommand({
        TableName: this.props.tableName,
        IndexName: this.props.reverseIndexName,
        KeyConditionExpression: "#sk = :sk",
        ExpressionAttributeNames: { "#sk": "sk" },
        ExpressionAttributeValues: { ":sk": "user" },
        Limit: 1,
      }),
    );

    return items != null && items.length > 0;
  };

  readonly listAll = async (): Promise<Array<User>> => {
    const { Items: items } = await this.props.dynamo.send(
      new QueryCommand({
        TableName: this.props.tableName,
        IndexName: this.props.reverseIndexName,
        KeyConditionExpression: "#sk = :sk",
        ExpressionAttributeNames: { "#sk": "sk" },
        ExpressionAttributeValues: { ":sk": "user" },
      }),
    );

    if (items == null) return [];
    return items.map((item) => this.parseOne(item));
  };

  readonly updateDomains = async ({
    email,
    domains,
  }: {
    readonly email: string;
    readonly domains: Array<string>;
  }): Promise<void> => {
    try {
      await this.props.dynamo.send(
        new UpdateCommand({
          TableName: this.props.tableName,
          Key: { pk: `user#${email}`, sk: "user" },
          UpdateExpression: "SET #domains = :domains",
          ConditionExpression: "attribute_exists(pk) AND attribute_exists(sk)",
          ExpressionAttributeNames: { "#domains": "domains" },
          ExpressionAttributeValues: { ":domains": domains },
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
        throw new UserNotFoundError(email);
      }
      throw error;
    }
  };

  readonly updateType = async ({
    email,
    type,
  }: {
    readonly email: string;
    readonly type: UserType;
  }): Promise<void> => {
    try {
      await this.props.dynamo.send(
        new UpdateCommand({
          TableName: this.props.tableName,
          Key: { pk: `user#${email}`, sk: "user" },
          UpdateExpression: "SET #type = :type",
          ConditionExpression: "attribute_exists(pk) AND attribute_exists(sk)",
          ExpressionAttributeNames: { "#type": "type" },
          ExpressionAttributeValues: { ":type": type },
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
        throw new UserNotFoundError(email);
      }
      throw error;
    }
  };

  readonly delete = async ({ email }: { readonly email: string }): Promise<void> => {
    await this.props.dynamo.send(
      new DeleteCommand({
        TableName: this.props.tableName,
        Key: { pk: `user#${email}`, sk: "user" },
      }),
    );
  };

  private readonly parseOne = (item: unknown): User => {
    const result = v.safeParse(schema, item);
    if (!result.success) {
      console.error(v.flatten(result.issues));
      throw new Error("Malformed stored user record");
    }
    return result.output;
  };
}

export class UserNotFoundError extends Error {
  constructor(email: string) {
    super(`User not found: ${email}`);
    this.name = "UserNotFoundError";
  }
}

export class UserAlreadyExistsError extends Error {
  constructor(email: string) {
    super(`User already exists: ${email}`);
    this.name = "UserAlreadyExistsError";
  }
}
