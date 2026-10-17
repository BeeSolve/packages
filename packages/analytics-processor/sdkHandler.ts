import { assertUnreachable, decodeFromStringifiable } from "@beesolve/helpers";
import { keptActive } from "@beesolve/lambda-keep-active/runtime";
import * as v from "valibot";

import { Config } from "./src/config.ts";
import { toDynamoClient } from "./src/dynamo.ts";
import { syncSitemapWatch } from "./src/processHour.ts";
import { watchModes, watchSources, watchStatuses } from "./src/watch.ts";

const envSchema = v.object({
  TABLE_NAME: v.string(),
  REVERSE_INDEX_NAME: v.string(),
});
const env = v.parse(envSchema, process.env);

const dynamo = toDynamoClient();
const config = new Config({
  dynamo,
  tableName: env.TABLE_NAME,
  reverseIndexName: env.REVERSE_INDEX_NAME,
});

const updateSitemapUrlSchema = v.object({
  sitemapUrl: v.pipe(v.string(), v.url()),
});

const upsertWatchSchema = v.object({
  matcher: v.string(),
  mode: v.picklist(watchModes),
  source: v.picklist(watchSources),
  status: v.optional(v.picklist(watchStatuses)),
  label: v.optional(v.string()),
});

const setWatchStatusSchema = v.object({
  matcher: v.string(),
  status: v.picklist(watchStatuses),
});

const deleteWatchSchema = v.object({
  matcher: v.string(),
});

const syncSitemapNowSchema = v.optional(v.object({}), {});

type UpdateSitemapUrlCommand = {
  readonly type: "updateSitemapUrl";
  readonly request: { readonly sitemapUrl: string };
  readonly response: undefined;
};

type UpsertWatchCommand = {
  readonly type: "upsertWatch";
  readonly request: v.InferOutput<typeof upsertWatchSchema>;
  readonly response: undefined;
};

type SetWatchStatusCommand = {
  readonly type: "setWatchStatus";
  readonly request: v.InferOutput<typeof setWatchStatusSchema>;
  readonly response: undefined;
};

type DeleteWatchCommand = {
  readonly type: "deleteWatch";
  readonly request: { readonly matcher: string };
  readonly response: undefined;
};

type SyncSitemapNowCommand = {
  readonly type: "syncSitemapNow";
  readonly request: Record<string, never>;
  readonly response: undefined;
};

export type Commands =
  | UpdateSitemapUrlCommand
  | UpsertWatchCommand
  | SetWatchStatusCommand
  | DeleteWatchCommand
  | SyncSitemapNowCommand;

type ToRequest<C extends Commands> = C extends unknown
  ? { type: C["type"]; request: C["request"] }
  : never;

type HandlerEvent = ToRequest<Commands>;

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

  if (type === "upsertWatch") {
    const { matcher, mode, source, status, label } = v.parse(upsertWatchSchema, request);
    await config.upsertWatch({ matcher, mode, source, status, label });
    return;
  }

  if (type === "setWatchStatus") {
    const { matcher, status } = v.parse(setWatchStatusSchema, request);
    await config.setWatchStatus({ matcher, status });
    return;
  }

  if (type === "deleteWatch") {
    const { matcher } = v.parse(deleteWatchSchema, request);
    await config.deleteWatch({ matcher });
    return;
  }

  if (type === "syncSitemapNow") {
    v.parse(syncSitemapNowSchema, request);
    await syncSitemapWatch({ config });
    return;
  }

  assertUnreachable(type);
});
