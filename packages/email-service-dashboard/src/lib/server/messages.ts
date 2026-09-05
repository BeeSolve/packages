import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { BatchGetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { assertUnreachable, call, splitArrayToChunks } from "@beesolve/helpers";
import * as v from "valibot";

import { decodeCursor, defaultLimit, emailSchema, encodeCursor } from "./schema";

export const messageStatuses = ["sent", "delivered", "bounced", "complained", "rejected"] as const;
export type MessageStatus = (typeof messageStatuses)[number];

export const bounceTypes = ["Permanent", "Transient", "Undetermined"] as const;
export type BounceType = (typeof bounceTypes)[number];

const dateSchema = v.pipe(v.string(), v.isoTimestamp());

const entity = "message" as const;

const requestSchema = v.object({
  status: v.literal("requested"),
  requestId: v.string(),
  timestamp: dateSchema,
});
type RequestEvent = v.InferInput<typeof requestSchema>;
const sendSchema = v.object({ status: v.literal("sent"), timestamp: dateSchema });
type SendEvent = v.InferInput<typeof sendSchema>;
const deliverySchema = v.object({
  status: v.literal("delivered"),
  deliveredAt: v.string(),
  deliveryMs: v.number(),
  timestamp: dateSchema,
  recipients: v.array(emailSchema),
});
type DeliveryEvent = v.InferInput<typeof deliverySchema>;
const bounceSchema = v.object({
  status: v.literal("bounced"),
  bounceType: v.picklist(bounceTypes),
  bounceSubType: v.string(),
  diagnosticCode: v.optional(v.string()),
  at: v.string(),
  timestamp: dateSchema,
  recipients: v.array(emailSchema),
});
type BounceEvent = v.InferInput<typeof bounceSchema>;

const complainSchema = v.object({
  status: v.literal("complained"),
  feedbackType: v.optional(v.string()),
  at: v.string(),
  timestamp: dateSchema,
  recipients: v.array(emailSchema),
});
type ComplaintEvent = v.InferInput<typeof complainSchema>;

const rejectSchema = v.object({
  status: v.literal("rejected"),
  reason: v.string(),
  at: v.string(),
  timestamp: dateSchema,
  recipients: v.array(emailSchema),
});
type RejectEvent = v.InferInput<typeof rejectSchema>;

export const logEntrySchema = v.variant("status", [
  requestSchema,
  sendSchema,
  v.omit(deliverySchema, ["recipients"]),
  v.omit(bounceSchema, ["recipients"]),
  v.omit(complainSchema, ["recipients"]),
  v.omit(rejectSchema, ["recipients"]),
]);
export type LogEntry = v.InferOutput<typeof logEntrySchema>;

// get => pk: messageId sk: 'message'
export const messageSchema = v.object({
  pk: v.string(), // messageId
  sk: v.literal(entity),
  requestId: v.string(),
  recipients: v.array(emailSchema),
  messageLog: v.set(
    v.pipe(
      v.string(),
      v.parseJson(),
      v.intersect([
        v.object({
          recipient: emailSchema,
        }),
        logEntrySchema,
      ]),
    ),
  ),
  idempotencyKeys: v.set(v.string()),
  sender: v.string(),
  subject: v.string(),
  createdAt: dateSchema,
  updatedAt: dateSchema,
});
export type Message = v.InferOutput<typeof messageSchema>;
export type MessageModel = Awaited<ReturnType<Messages["toModel"]>>;

// query => pk = email + paginate
// query => pk = email and begins_with(sk, YYYY-MM) + paginate
const recipientQuerySchema = v.object({
  pk: emailSchema,
  sk: v.pipe(
    v.string(),
    v.transform((value) => {
      const [prefix, timestamp, messageId] = value.split("#");

      return { prefix, timestamp, messageId };
    }),
    v.object({
      prefix: v.literal(entity),
      timestamp: dateSchema,
      messageId: v.string(),
    }),
  ),
});

// query => pk = YYYY-MM + paginate
const messageQuerySchema = v.object({
  pk: v.pipe(
    v.string(),
    v.check((value) => {
      const [year, month] = value.split("-");
      if (year == null) return false;
      if (year.length !== 4) return false;
      if (Number.isNaN(Number(year))) return false;

      if (month == null) return false;
      if (month.length !== 2) return false;
      if (Number.isNaN(Number(month))) return false;

      if (Number(month) < 1 || Number(month) > 12) return false;

      return true;
    }),
  ),
  sk: v.pipe(
    v.string(),
    v.transform((value) => {
      const [timestamp, messageId] = value.split("#");

      return { timestamp, messageId };
    }),
    v.object({
      messageId: v.string(),
      timestamp: dateSchema,
    }),
  ),
});

export class Messages {
  constructor(
    private readonly props: {
      readonly dynamo: Pick<DynamoDBDocumentClient, "send">;
      readonly tableName: string;
      readonly reverseIndexName: string;
    },
  ) {}

  // todo: we need to verify all the inserted data before we instert them (through valibot schemas)
  readonly upsert = async (props: {
    readonly eventId: string;
    readonly messageId: string;
    readonly recipients: Array<string>;
    readonly subject: string;
    readonly sender: string;
    readonly createdAt: string;
    readonly data:
      | RequestEvent
      | SendEvent
      | DeliveryEvent
      | BounceEvent
      | ComplaintEvent
      | RejectEvent;
  }): Promise<void> => {
    if (props.recipients.length > 48) {
      throw new Error(`Only can store up to 48 recipients. Transaction won't hold more.`);
    }
    if (props.recipients.length === 0) {
      throw new Error(`At least one recipient is required.`);
    }

    const statusRecipients = call(() => {
      if (props.data.status === "sent" || props.data.status === "requested") {
        return props.recipients;
      }
      if (
        props.data.status === "bounced" ||
        props.data.status === "complained" ||
        props.data.status === "delivered" ||
        props.data.status === "rejected"
      ) {
        return props.data.recipients;
      }

      assertUnreachable(props.data);
    });

    const messageLog = call(() => {
      if (props.data.status === "sent" || props.data.status === "requested") {
        return props.recipients.map((recipient) =>
          JSON.stringify(sortKeys({ recipient, ...props.data })),
        );
      }
      if (
        props.data.status === "bounced" ||
        props.data.status === "complained" ||
        props.data.status === "delivered" ||
        props.data.status === "rejected"
      ) {
        const { recipients, ...rest } = props.data;
        return recipients.map((recipient) => JSON.stringify(sortKeys({ recipient, ...rest })));
      }

      assertUnreachable(props.data);
    });

    const requestId = props.data.status === "requested" ? props.data.requestId : "unknown";

    try {
      await this.props.dynamo.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: this.props.tableName,
                Key: {
                  pk: props.messageId,
                  sk: entity,
                },
                UpdateExpression: `SET #requestId = :requestId, #recipients = :recipients, #sender = :sender, #subject = :subject, #createdAt = :createdAt, #updatedAt = :updatedAt ADD #messageLog :messageLog, #idempotencyKeys :eventIdSet`,
                ConditionExpression: "not contains(#idempotencyKeys, :eventId)",
                ExpressionAttributeNames: {
                  "#requestId": "requestId",
                  "#recipients": "recipients",
                  "#sender": "sender",
                  "#subject": "subject",
                  "#createdAt": "createdAt",
                  "#updatedAt": "updatedAt",
                  "#messageLog": "messageLog",
                  "#idempotencyKeys": "idempotencyKeys",
                },
                ExpressionAttributeValues: {
                  ":requestId": requestId,
                  ":recipients": props.recipients,
                  ":sender": props.sender,
                  ":subject": props.subject,
                  ":createdAt": props.createdAt,
                  ":updatedAt": new Date().toISOString(),
                  ":messageLog": new Set(messageLog),
                  ":eventIdSet": new Set([props.eventId]),
                  ":eventId": props.eventId,
                },
              },
            },
            // update global stats - statsSchema
            {
              Update: {
                TableName: this.props.tableName,
                Key: { pk: "stats" as const, sk: "global" as const },
                UpdateExpression: "ADD #counter :one",
                ExpressionAttributeNames: { "#counter": props.data.status },
                ExpressionAttributeValues: { ":one": 1 },
              },
            },
            // update stats per recipient - recipientSchema
            ...statusRecipients.map((email) => ({
              Update: {
                TableName: this.props.tableName,
                Key: { pk: email, sk: "recipient" as const },
                UpdateExpression: "ADD #counter :one",
                ExpressionAttributeNames: { "#counter": props.data.status },
                ExpressionAttributeValues: { ":one": 1 },
              },
            })),

            // recipient query records - recipientQuerySchema
            ...props.recipients.map((email) => ({
              Put: {
                TableName: this.props.tableName,
                Item: {
                  pk: email,
                  sk: `${entity}#${props.createdAt}#${props.messageId}`,
                },
              },
            })),
            // global query record - messageQuerySchema
            {
              Put: {
                TableName: this.props.tableName,
                Item: {
                  pk: props.createdAt.slice(0, 7), // YYYY-MM
                  sk: `${props.createdAt}#${props.messageId}`,
                },
              },
            },
          ],
        }),
      );
    } catch (error) {
      if (isAlreadyApplied(error)) return;
      throw error;
    }
  };

  readonly messageManyByRecipient = async ({
    email,
    limit = defaultLimit,
    cursor,
  }: {
    readonly email: string;
    readonly limit?: number;
    readonly cursor?: string;
  }): Promise<{ items: Array<MessageModel>; cursor?: string }> => {
    const { Items: items = [], LastEvaluatedKey: lastKey } = await this.props.dynamo.send(
      new QueryCommand({
        TableName: this.props.tableName,
        KeyConditionExpression: "#pk = :pk and begins_with(#sk, :sk)",
        ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
        ExpressionAttributeValues: {
          ":pk": email.trim().toLowerCase(),
          ":sk": `${entity}#`,
        },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: decodeCursor(cursor),
        ProjectionExpression: ["#pk", "#sk"].join(),
      }),
    );

    const keys = items.map((raw) => v.parse(recipientQuerySchema, raw));

    const messages = new Array<MessageModel>();

    for (const batch of splitArrayToChunks(keys, 100)) {
      const { Responses = {} } = await this.props.dynamo.send(
        new BatchGetCommand({
          RequestItems: {
            [this.props.tableName]: {
              Keys: batch.map(({ sk: { messageId } }) => ({
                pk: messageId,
                sk: entity,
              })),
            },
          },
        }),
      );

      const messagesRaw = Responses[this.props.tableName] ?? [];

      messages.push(...messagesRaw.map((raw) => this.toModel(this.parseOne(raw))));
    }

    return { items: messages, cursor: encodeCursor(lastKey) };
  };

  // todo: here we could create algorithm which will go through multiple "months" in PK until the limit is reached
  // or the props could be from/to months and we would get all betweeen with correct computed pagination - the cursor would encode current PK as well
  readonly messagesManyForMonth = async ({
    month,
    limit = defaultLimit,
    cursor,
  }: {
    readonly month: {
      readonly year: number;
      readonly month: number;
    };
    readonly limit?: number;
    readonly cursor?: string;
  }): Promise<{ items: Array<MessageModel>; cursor?: string }> => {
    const { Items: items = [], LastEvaluatedKey: lastKey } = await this.props.dynamo.send(
      new QueryCommand({
        TableName: this.props.tableName,
        KeyConditionExpression: "#pk = :pk",
        ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
        ExpressionAttributeValues: {
          ":pk": `${month.year}-${month.month.toString().padStart(2, "0")}`,
        },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: decodeCursor(cursor),
        ProjectionExpression: ["#pk", "#sk"].join(),
      }),
    );

    const keys = items.map((raw) => v.parse(messageQuerySchema, raw));

    const messages = new Array<MessageModel>();

    for (const batch of splitArrayToChunks(keys, 100)) {
      const { Responses = {} } = await this.props.dynamo.send(
        new BatchGetCommand({
          RequestItems: {
            [this.props.tableName]: {
              Keys: batch.map(({ sk: { messageId } }) => ({
                pk: messageId,
                sk: entity,
              })),
            },
          },
        }),
      );

      const messagesRaw = Responses[this.props.tableName] ?? [];

      messages.push(...messagesRaw.map((raw) => this.toModel(this.parseOne(raw))));
    }

    return { items: messages, cursor: encodeCursor(lastKey) };
  };

  private readonly parseOne = (item: unknown): Message => {
    const result = v.safeParse(messageSchema, item);
    if (!result.success) {
      console.error(v.flatten(result.issues));
      throw new Error("Malformed stored message record");
    }
    return result.output;
  };

  private readonly toModel = ({
    createdAt,
    messageLog,
    pk,
    recipients,
    requestId,
    sender,
    subject,
    updatedAt,
  }: Message) => {
    const log = Array.from(messageLog).sort((left, right) =>
      left.timestamp.localeCompare(right.timestamp),
    );
    return {
      id: pk,
      recipients,
      logByRecipient: log.reduce(
        (result, current) => {
          const { recipient, ...rest } = current;
          if (result[recipient] == null) result[recipient] = new Array<LogEntry>();
          result[recipient].push(rest);
          return result;
        },
        {} as Record<string, Array<LogEntry>>,
      ),
      requestId,
      sender,
      subject,
      createdAt,
      updatedAt,
      messageLog: log,
      status: log.at(-1)?.status ?? "requested",
    };
  };
}

function isAlreadyApplied(error: unknown): boolean {
  if (!(error instanceof TransactionCanceledException)) return false;
  return error.CancellationReasons?.[0]?.Code === "ConditionalCheckFailed";
}

function sortKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return value.map(sortKeys) as T;
  }
  if (value != null && typeof value === "object") {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    ) as T;
  }
  return value;
}
