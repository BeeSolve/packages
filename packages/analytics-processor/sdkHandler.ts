import { assertUnreachable, decodeFromStringifiable } from "@beesolve/helpers";
import { keptActive } from "@beesolve/lambda-keep-active/runtime";
import * as v from "valibot";

import { Config } from "./src/config.ts";
import { toDynamoClient } from "./src/dynamo.ts";

const envSchema = v.object({
  TABLE_NAME: v.string(),
});
const env = v.parse(envSchema, process.env);

const dynamo = toDynamoClient();
const config = new Config({ dynamo, tableName: env.TABLE_NAME });

const updateSitemapUrlSchema = v.object({
  sitemapUrl: v.pipe(v.string(), v.url()),
});

type UpdateSitemapUrlCommand = {
  readonly type: "updateSitemapUrl";
  readonly request: { readonly sitemapUrl: string };
  readonly response: undefined;
};

export type Commands = UpdateSitemapUrlCommand;

type Command = {
  readonly type: string;
  readonly request: unknown;
  readonly response: unknown;
};

type ToRequest<C extends Command> = C extends unknown
  ? { type: C["type"]; request: C["request"] }
  : never;

type HandlerEvent = ToRequest<UpdateSitemapUrlCommand>;

export type RequestByType<T extends Commands["type"]> = T extends Commands["type"]
  ? Extract<Commands, { type: T }>["request"]
  : never;

export type ResponseByType<T extends Commands["type"]> = T extends Commands["type"]
  ? Extract<Commands, { type: T }>["response"]
  : never;

export type Types<T extends Commands> = T extends unknown ? T["type"] : never;

export const handler = keptActive(async (event: HandlerEvent) => {
  const { type, request } = decodeFromStringifiable<HandlerEvent>(event);

  if (type === "updateSitemapUrl") {
    const { sitemapUrl } = v.parse(updateSitemapUrlSchema, request);
    await config.setSitemapUrl({ sitemapUrl });
    return;
  }

  assertUnreachable(type);
});
