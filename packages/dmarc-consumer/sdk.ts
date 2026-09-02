import { uuid7 } from "@beesolve/helpers";
import * as v from "valibot";

import type { BackfillStatusSummary } from "./backfill.ts";
import { Backfill, deriveCanRun } from "./backfill.ts";
import { toDynamoClient } from "./src/dynamo.ts";
import { tasks } from "./src/tasks.ts";

type StartBackfillResult =
  | { readonly enqueued: true; readonly runId: string }
  | { readonly enqueued: false; readonly reason: "already-running" };

const env = v.parse(v.object({ TABLE_NAME: v.string() }), process.env);

const dynamo = toDynamoClient();

export class BackfillSdk {
  private readonly model = new Backfill({ dynamo, tableName: env.TABLE_NAME });

  readonly start = async (props: { readonly domain: string }): Promise<StartBackfillResult> => {
    const runId = uuid7();
    const startedAt = new Date().toISOString();

    try {
      await this.model.startRun({ domain: props.domain, runId, startedAt });
    } catch (error) {
      if (isAlreadyRunning(error)) {
        return { enqueued: false, reason: "already-running" };
      }
      throw error;
    }

    await tasks.backfillDomain({ domain: props.domain, runId });
    return { enqueued: true, runId };
  };

  readonly getStatuses = async (): Promise<Record<string, BackfillStatusSummary>> => {
    const config = await this.model.readConfig();
    if (config == null) return {};

    const statuses: Record<string, BackfillStatusSummary> = {};
    for (const [domain, entry] of Object.entries(config.domains)) {
      statuses[domain] = {
        canRun: deriveCanRun(config, domain),
        lastRun: {
          status: entry.status,
          startedAt: entry.startedAt,
          finishedAt: entry.finishedAt,
          ipsEnriched: entry.ipsEnriched,
        },
      };
    }

    return statuses;
  };
}

function isAlreadyRunning(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  if (!("name" in error) || error.name !== "TransactionCanceledException") return false;
  if (!("CancellationReasons" in error) || !Array.isArray(error.CancellationReasons)) return false;

  const configReason = error.CancellationReasons[0];
  return (
    configReason != null &&
    typeof configReason === "object" &&
    "Code" in configReason &&
    configReason.Code === "ConditionalCheckFailed"
  );
}
