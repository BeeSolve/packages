import { randomBytes } from "node:crypto";

import { EventBridge } from "@aws-sdk/client-eventbridge";
import { asNull, assertUnreachable, decodeFromStringifiable } from "@beesolve/helpers";
import { keptActive } from "@beesolve/lambda-keep-active/runtime";
import * as v from "valibot";

import { Accounts } from "./src/account.ts";
import { toDynamoClient } from "./src/dynamo.ts";
import { Events } from "./src/events.ts";
import { type UserSession, Sessions } from "./src/session.ts";

const envSchema = v.object({
  SESSIONS_TABLE_NAME: v.string(),
  SESSIONS_USER_ID_INDEX_NAME: v.string(),
  ACCOUNTS_TABLE_NAME: v.string(),
  ACCOUNTS_REVERSE_INDEX_NAME: v.string(),
  EVENT_BUS_ARN: v.string(),
  EVENT_SOURCE: v.string(),
  MAX_IMPERSONATION_DURATION: v.optional(v.pipe(v.string(), v.transform(Number), v.number())),
});
const env = v.parse(envSchema, process.env);

const dynamo = toDynamoClient();
const sessions = new Sessions({
  dynamo,
  tableName: env.SESSIONS_TABLE_NAME,
  userIdIndexName: env.SESSIONS_USER_ID_INDEX_NAME,
});
const accounts = new Accounts({
  dynamo,
  tableName: env.ACCOUNTS_TABLE_NAME,
  reverseIndexName: env.ACCOUNTS_REVERSE_INDEX_NAME,
});
const events = new Events({
  client: new EventBridge(),
  eventBusArn: env.EVENT_BUS_ARN,
  eventSource: env.EVENT_SOURCE,
});

const newEmailAccountSchema = v.object({
  accountId: v.optional(v.string()),
  emailAddress: v.pipe(v.string(), v.email()),
});

const accountIdByEmailSchema = v.object({
  emailAddress: v.pipe(v.string(), v.email()),
});

const sessionListSchema = v.object({
  accountId: v.string(),
});

const deleteAllSessionsSchema = v.object({
  accountId: v.string(),
  exceptSessionId: v.optional(v.string()),
});

const impersonateSchema = v.object({
  targetUserId: v.string(),
  currentUserId: v.string(),
  maxAge: v.optional(v.number()),
});

type NewEmailAccountCommand = {
  readonly type: "newEmailAccount";
  readonly request: v.InferInput<typeof newEmailAccountSchema>;
  readonly response: {
    readonly id: string;
  };
};

type AccountIdByEmailRequest = {
  readonly type: "accountIdByEmail";
  readonly request: v.InferInput<typeof accountIdByEmailSchema>;
  readonly response: { readonly id: string } | null;
};

type SessionListRequest = {
  readonly type: "sessionList";
  readonly request: v.InferInput<typeof sessionListSchema>;
  readonly response: Array<UserSession>;
};

type DeleteAllSessionsRequest = {
  readonly type: "deleteAllSessions";
  readonly request: v.InferInput<typeof deleteAllSessionsSchema>;
  readonly response: undefined;
};

type ImpersonateCommand = {
  readonly type: "impersonate";
  readonly request: v.InferInput<typeof impersonateSchema>;
  readonly response: { readonly sid: string; readonly maxAge: number };
};

export type Commands =
  | NewEmailAccountCommand
  | AccountIdByEmailRequest
  | SessionListRequest
  | DeleteAllSessionsRequest
  | ImpersonateCommand;

type Command = {
  readonly type: string;
  readonly request: unknown;
  readonly response: unknown;
};

type ToRequest<C extends Command> = C extends unknown
  ? { type: C["type"]; request: C["request"] }
  : never;

type HandlerEvent = ToRequest<
  | NewEmailAccountCommand
  | AccountIdByEmailRequest
  | SessionListRequest
  | DeleteAllSessionsRequest
  | ImpersonateCommand
>;

export type RequestByType<T extends Commands["type"]> = T extends Commands["type"]
  ? Extract<Commands, { type: T }>["request"]
  : never;

export type ResponseByType<T extends Commands["type"]> = T extends Commands["type"]
  ? Extract<Commands, { type: T }>["response"]
  : never;

export type Types<T extends Commands> = T extends unknown ? T["type"] : never;

export const handler = keptActive(async (event: HandlerEvent) => {
  const { type, request } = decodeFromStringifiable<HandlerEvent>(event);

  if (type === "newEmailAccount") {
    const parsed = v.parse(newEmailAccountSchema, request);
    const accountId = parsed.accountId ?? randomBytes(32).toString("base64url");

    const { id } = await accounts.createNew({
      id: accountId,
      type: "email",
      username: parsed.emailAddress,
    });

    return { id };
  }

  if (type === "accountIdByEmail") {
    const parsed = v.parse(accountIdByEmailSchema, request);
    const account = await accounts.getOne(parsed.emailAddress).catch(asNull);
    if (account == null) return null;

    return { id: account.id };
  }

  if (type === "sessionList") {
    const parsed = v.parse(sessionListSchema, request);
    const now = Date.now();
    const sessionsList = await sessions.listMany(parsed.accountId);

    return sessionsList
      .filter(({ expiresAt }) => Date.parse(expiresAt) > now)
      .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))
      .map(({ data, expiresAt, id, startedAt, updatedAt }) => ({
        id,
        data,
        expiresAt,
        startedAt,
        updatedAt,
      }));
  }

  if (type === "deleteAllSessions") {
    const parsed = v.parse(deleteAllSessionsSchema, request);
    await sessions.deleteAllForUser({
      userId: parsed.accountId,
      exceptSessionId: parsed.exceptSessionId,
    });
    return;
  }

  if (type === "impersonate") {
    const parsed = v.parse(impersonateSchema, request);
    const cap = env.MAX_IMPERSONATION_DURATION ?? 14400;
    const maxAge = Math.min(parsed.maxAge ?? 3600, cap);
    const session = await sessions.createOne({
      userId: parsed.targetUserId,
      maxAge,
      data: {},
      impersonatedBy: parsed.currentUserId,
    });
    await events.putEvents({
      type: "ImpersonationStarted",
      detail: {
        currentUserId: parsed.currentUserId,
        targetUserId: parsed.targetUserId,
        startedAt: new Date().toISOString(),
      },
    });
    return { sid: session.id, maxAge };
  }

  assertUnreachable(type);
});
