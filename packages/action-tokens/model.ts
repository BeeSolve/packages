import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

const schema = v.object({
  owner: v.string(),
  action: v.string(),
  value: v.string(),
  remainingUses: v.number(),
  createdAt: v.pipe(
    v.string(),
    v.transform((value) => new Date(value)),
    v.date(),
  ),
  expiresAt: v.pipe(
    v.number(),
    v.transform((value) => new Date(value * 1000)),
    v.date(),
  ),
  data: v.optional(v.record(v.string(), v.unknown())),
});
type NewToken = v.InferInput<typeof schema>;
type Token = v.InferOutput<typeof schema>;

export class ActionTokens {
  constructor(
    private readonly props: {
      readonly dynamo: Pick<DynamoDBDocumentClient, "send">;
      readonly tableName: string;
      readonly valueIndexName: string;
    },
  ) {}

  readonly createNew = async (props: {
    readonly owner: string;
    readonly action: string;
    readonly value: string;
    readonly remainingUses: number;
    readonly expiresAt: Date;
    readonly data: Record<string, unknown> | undefined;
    readonly overwrite: boolean;
  }) => {
    const item: NewToken = {
      owner: props.owner,
      action: props.action,
      value: props.value,
      expiresAt: Math.round(props.expiresAt.getTime() / 1000),
      remainingUses: props.remainingUses,
      data: props.data,
      createdAt: new Date().toISOString(),
    };

    // Parse before writing so the returned Token reflects any schema
    // transformations (e.g. string → Date). If the schema evolves, the caller
    // always gets back exactly what the schema would produce.
    const model = this.parseOne(
      item,
      "Unexpected error occurred while creating token. Token has not been created.",
    );

    const condition:
      | Pick<
          PutCommand["input"],
          "ConditionExpression" | "ExpressionAttributeNames"
        >
      | undefined = props.overwrite
      ? undefined
      : {
          ConditionExpression:
            "attribute_not_exists(#put_owner) and attribute_not_exists(#put_action)",
          ExpressionAttributeNames: {
            "#put_owner": "owner",
            "#put_action": "action",
          },
        };

    try {
      await this.props.dynamo.send(
        new PutCommand({
          TableName: this.props.tableName,
          Item: item,
          ...condition,
        }),
      );
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        throw new TokenAlreadyExistsError("Token already exists.");
      }
      throw error;
    }

    return model;
  };

  readonly use = async (props: {
    readonly owner: string | undefined;
    readonly action: string;
    readonly value: string;
    readonly drainWhenValid: boolean;
  }) => {
    const token = await (props.owner == null
      ? this.getOneByValue({ action: props.action, value: props.value })
      : this.getOneByOwner({ action: props.action, owner: props.owner }));

    if (token.expiresAt.getTime() <= Date.now())
      throw new ExpiredTokenError("Token has expired.");
    if (token.remainingUses <= 0)
      throw new TokenAlreadyUsedUpError("Token cannot be used anymore.");

    const isValueValid = token.value === props.value;
    const shouldDrain = isValueValid && props.drainWhenValid;

    // The update runs before the value check intentionally: an incorrect value
    // still consumes a use, preventing brute-force enumeration of the token value.
    const { Attributes: updated } = await this.sendUpdate(token, shouldDrain);

    if (!isValueValid) throw new TokenInvalidError("Token is invalid.");

    return this.parseOne(updated);
  };

  private readonly sendUpdate = async (token: Token, shouldDrain: boolean) => {
    try {
      return this.props.dynamo.send(
        new UpdateCommand({
          TableName: this.props.tableName,
          Key: {
            owner: token.owner,
            action: token.action,
          },
          UpdateExpression: "SET #remainingUses = :newRemainingUses",
          ConditionExpression: `#remainingUses = :remainingUses and #expiresAt > :now`,
          ExpressionAttributeNames: {
            "#remainingUses": "remainingUses",
            "#expiresAt": "expiresAt",
          },
          ExpressionAttributeValues: {
            ":remainingUses": token.remainingUses,
            ":newRemainingUses": shouldDrain ? 0 : token.remainingUses - 1,
            ":now": Math.round(Date.now() / 1000),
          },
          ReturnValues: "ALL_NEW",
        }),
      );
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        throw new UnexpectedError(
          "Token was modified concurrently or expired during the operation.",
        );
      }
      throw error;
    }
  };

  readonly drain = async (props: {
    readonly owner: string;
    readonly action: string;
  }) => {
    await this.props.dynamo.send(
      new DeleteCommand({
        TableName: this.props.tableName,
        Key: {
          owner: props.owner,
          action: props.action,
        },
      }),
    );
  };

  private readonly getOneByValue = async (props: {
    readonly value: string;
    readonly action: string;
  }) => {
    const { Items: items = [] } = await this.props.dynamo.send(
      new QueryCommand({
        TableName: this.props.tableName,
        IndexName: this.props.valueIndexName,
        KeyConditionExpression: "#value = :value and #action = :action",
        ExpressionAttributeNames: {
          "#value": "value",
          "#action": "action",
        },
        ExpressionAttributeValues: {
          ":value": props.value,
          ":action": props.action,
        },
        Limit: 1,
        ConsistentRead: false,
      }),
    );

    if (items.length === 0)
      throw new TokenDoesNotExistError(`Token not found.`);
    // Limit:1 means DynamoDB returns at most one item, but this guard catches
    // any unexpected multi-item response and surfaces index corruption early.
    if (items.length !== 1)
      throw new UnexpectedError(`Unexpected error. Found more than 1 token.`);

    return this.parseOne(items[0]);
  };

  private readonly getOneByOwner = async (props: {
    readonly owner: string;
    readonly action: string;
  }) => {
    const { Item: item } = await this.props.dynamo.send(
      new GetCommand({
        Key: {
          owner: props.owner,
          action: props.action,
        },
        TableName: this.props.tableName,
        ConsistentRead: true,
      }),
    );

    if (item == null) throw new TokenDoesNotExistError("Token not found.");

    return this.parseOne(item);
  };

  private readonly parseOne = (
    item: unknown,
    errorMessage: string = `Malformed token.`,
  ) => {
    const result = v.safeParse(schema, item);
    if (!result.success) {
      console.error(v.flatten(result.issues));
      throw new MalformedTokenError(errorMessage);
    }

    return result.output;
  };
}

class BaseTokenError extends Error {
  public readonly stringified: boolean;

  constructor(message: unknown) {
    super(typeof message === "string" ? message : JSON.stringify(message));
    this.stringified = typeof message !== "string";
  }
}

export class TokenDoesNotExistError extends BaseTokenError {}
export class TokenAlreadyExistsError extends BaseTokenError {}
export class ExpiredTokenError extends BaseTokenError {}
export class TokenAlreadyUsedUpError extends BaseTokenError {}
export class TokenInvalidError extends BaseTokenError {}
export class MalformedTokenError extends BaseTokenError {}
export class UnexpectedError extends BaseTokenError {}
