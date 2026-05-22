import { randomBytes } from "node:crypto";
import {
  asNull,
  assertUnreachable,
  decodeFromStringifiable,
} from "@beesolve/helpers";
import { keptActive } from "@beesolve/lambda-keep-active/runtime";
import * as v from "valibot";
import { Accounts } from "./src/account.ts";
import { toDynamoClient } from "./src/dynamo.ts";
import { type Session, Sessions } from "./src/session.ts";

const envSchema = v.object({
  SESSIONS_TABLE_NAME: v.string(),
  SESSIONS_USER_ID_INDEX_NAME: v.string(),
  ACCOUNTS_TABLE_NAME: v.string(),
  ACCOUNTS_REVERSE_INDEX_NAME: v.string(),
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

type NewEmailAccountCommand = {
  readonly type: "newEmailAccount";
  readonly request: {
    readonly accountId?: string;
    readonly emailAddress: string;
  };
  readonly response: {
    readonly id: string;
  };
};

type AccountIdByEmailRequest = {
  readonly type: "accountIdByEmail";
  readonly request: { readonly emailAddress: string };
  readonly response: { readonly id: string } | null;
};

type SessionListRequest = {
  readonly type: "sessionList";
  readonly request: { readonly accountId: string };
  readonly response: Session[];
};

export type Commands =
  | NewEmailAccountCommand
  | AccountIdByEmailRequest
  | SessionListRequest;

type Command = {
  readonly type: string;
  readonly request: any;
  readonly response: any;
};

type ToRequest<C extends Command> = C extends any
  ? { type: C["type"]; request: C["request"] }
  : never;

type HandlerEvent = ToRequest<
  NewEmailAccountCommand | AccountIdByEmailRequest | SessionListRequest
>;

export type RequestByType<T extends Commands["type"]> =
  T extends Commands["type"]
    ? Extract<Commands, { type: T }>["request"]
    : never;

export type ResponseByType<T extends Commands["type"]> =
  T extends Commands["type"]
    ? Extract<Commands, { type: T }>["response"]
    : never;

export type Types<T extends Commands> = T extends any ? T["type"] : never;

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

export const handler = keptActive(async (event: HandlerEvent) => {
  const { type, request } = decodeFromStringifiable<HandlerEvent>(event);

  if (type === "newEmailAccount") {
    const parsed = v.parse(newEmailAccountSchema, request);
    const accountId =
      parsed.accountId ?? randomBytes(32).toString("base64url");

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
      .filter(({ expiresAt }) => expiresAt.getTime() > now)
      .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime())
      .map(({ data, expiresAt, id, startedAt, updatedAt }) => ({
        id,
        data,
        expiresAt,
        startedAt,
        updatedAt,
      }));
  }

  assertUnreachable(type);
});
