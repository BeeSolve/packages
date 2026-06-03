import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
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
      | Pick<PutCommand["input"], "ConditionExpression" | "ExpressionAttributeNames">
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

  /**
   * Creates a new token with throttle enforcement in a single transaction.
   * If a non-expired throttle record exists for this `throttle.id` + `action`,
   * throws `TokenThrottledError`. Both the token and throttle record are written
   * atomically — if either fails, neither is persisted.
   *
   * @example
   * ```ts
   * await actionTokens.createNewWithThrottling({
   *   owner: token,
   *   action: "signInRequest",
   *   value: code,
   *   remainingUses: 3,
   *   expiresAt,
   *   data: { emailAddress },
   *   overwrite: true,
   *   throttle: { id: emailAddress, windowSeconds: 60 },
   * });
   * ```
   */
  readonly createNewWithThrottling = async (props: {
    readonly owner: string;
    readonly action: string;
    readonly value: string;
    readonly remainingUses: number;
    readonly expiresAt: Date;
    readonly data: Record<string, unknown> | undefined;
    readonly overwrite: boolean;
    /** Throttle configuration. */
    readonly throttle: {
      /** Identifier to throttle on (e.g., email address). */
      readonly id: string;
      /** Minimum seconds between token creations for this id+action. */
      readonly windowSeconds: number;
    };
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

    const model = this.parseOne(
      item,
      "Unexpected error occurred while creating token. Token has not been created.",
    );

    const now = Math.round(Date.now() / 1000);

    const tokenPut = {
      Put: {
        TableName: this.props.tableName,
        Item: item,
        ...(props.overwrite
          ? {}
          : {
              ConditionExpression:
                "attribute_not_exists(#put_owner) and attribute_not_exists(#put_action)",
              ExpressionAttributeNames: {
                "#put_owner": "owner",
                "#put_action": "action",
              },
            }),
      },
    };

    const throttlePut = {
      Put: {
        TableName: this.props.tableName,
        Item: {
          owner: `throttle#${props.throttle.id}`,
          action: props.action,
          createdAt: new Date().toISOString(),
          expiresAt: now + props.throttle.windowSeconds,
        },
        ConditionExpression: "attribute_not_exists(#owner) OR #expiresAt <= :now",
        ExpressionAttributeNames: {
          "#owner": "owner",
          "#expiresAt": "expiresAt",
        },
        ExpressionAttributeValues: {
          ":now": now,
        },
      },
    };

    try {
      await this.props.dynamo.send(
        new TransactWriteCommand({
          TransactItems: [throttlePut, tokenPut],
        }),
      );
    } catch (error) {
      if (error instanceof TransactionCanceledException) {
        const reasons = error.CancellationReasons ?? [];
        if (reasons[0]?.Code === "ConditionalCheckFailed") {
          throw new TokenThrottledError("Too many requests. Try again later.");
        }
        if (reasons[1]?.Code === "ConditionalCheckFailed") {
          throw new TokenAlreadyExistsError("Token already exists.");
        }
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

    if (token.expiresAt.getTime() <= Date.now()) throw new ExpiredTokenError("Token has expired.");
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

  /**
   * Reads a token without decrementing `remainingUses`.
   * Validates expiry and remaining uses — throws if the token is expired or used up.
   * Use this to check token status or display metadata without consuming an attempt.
   */
  readonly peek = async (props: { readonly owner: string; readonly action: string }) => {
    const { Item: item } = await this.props.dynamo.send(
      new GetCommand({
        Key: { owner: props.owner, action: props.action },
        TableName: this.props.tableName,
        ConsistentRead: true,
      }),
    );

    if (item == null) throw new TokenDoesNotExistError("Token not found.");

    const token = this.parseOne(item);
    if (token.expiresAt.getTime() <= Date.now()) throw new ExpiredTokenError("Token has expired.");
    if (token.remainingUses <= 0)
      throw new TokenAlreadyUsedUpError("Token cannot be used anymore.");

    return token;
  };

  readonly drain = async (props: { readonly owner: string; readonly action: string }) => {
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

    if (items.length === 0) throw new TokenDoesNotExistError(`Token not found.`);
    // Limit:1 means DynamoDB returns at most one item, but this guard catches
    // any unexpected multi-item response and surfaces index corruption early.
    if (items.length !== 1) throw new UnexpectedError(`Unexpected error. Found more than 1 token.`);

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

  private readonly parseOne = (item: unknown, errorMessage: string = `Malformed token.`) => {
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
export class TokenThrottledError extends BaseTokenError {}
