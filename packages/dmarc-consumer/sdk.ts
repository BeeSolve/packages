import { uuid7 } from "@beesolve/helpers";
import * as v from "valibot";

import type { JobStatusSummary } from "./jobRuns.ts";
import { deriveCanRun, isAlreadyRunning, JobRuns } from "./jobRuns.ts";
import { toDynamoClient } from "./src/dynamo.ts";
import { tasks } from "./src/tasks.ts";

type StartRunResult =
  | { readonly enqueued: true; readonly runId: string }
  | { readonly enqueued: false; readonly reason: "already-running" };

const env = v.parse(v.object({ TABLE_NAME: v.string() }), process.env);

const dynamo = toDynamoClient();

export class AdminSdk {
  private readonly ipBackfill = new JobRuns({
    dynamo,
    tableName: env.TABLE_NAME,
    kind: "ipBackfill",
  });

  private readonly dnsRefresh = new JobRuns({
    dynamo,
    tableName: env.TABLE_NAME,
    kind: "dnsRefresh",
  });

  readonly startIpBackfill = async (props: {
    readonly domain: string;
  }): Promise<StartRunResult> => {
    const runId = uuid7();
    const startedAt = new Date().toISOString();

    try {
      await this.ipBackfill.startRun({ domain: props.domain, runId, startedAt });
    } catch (error) {
      if (isAlreadyRunning(error)) {
        return { enqueued: false, reason: "already-running" };
      }
      throw error;
    }

    await tasks.backfillDomain({ domain: props.domain, runId });
    return { enqueued: true, runId };
  };

  readonly getIpBackfillStatuses = async (): Promise<Record<string, JobStatusSummary>> => {
    return this.summarize(this.ipBackfill);
  };

  readonly startDnsRefresh = async (props: {
    readonly domain: string;
  }): Promise<StartRunResult> => {
    const runId = uuid7();
    const startedAt = new Date().toISOString();

    try {
      await this.dnsRefresh.startRun({ domain: props.domain, runId, startedAt });
    } catch (error) {
      if (isAlreadyRunning(error)) {
        return { enqueued: false, reason: "already-running" };
      }
      throw error;
    }

    await tasks.refreshDomainDns({ domain: props.domain, runId });
    return { enqueued: true, runId };
  };

  readonly getDnsRefreshStatuses = async (): Promise<Record<string, JobStatusSummary>> => {
    return this.summarize(this.dnsRefresh);
  };

  private readonly summarize = async (
    jobRuns: JobRuns,
  ): Promise<Record<string, JobStatusSummary>> => {
    const config = await jobRuns.readConfig();
    if (config == null) return {};

    const statuses: Record<string, JobStatusSummary> = {};
    for (const [domain, entry] of Object.entries(config.domains)) {
      statuses[domain] = {
        canRun: deriveCanRun(config, domain),
        lastRun: {
          status: entry.status,
          startedAt: entry.startedAt,
          finishedAt: entry.finishedAt,
          ipsEnriched: entry.ipsEnriched,
          selectorsChecked: entry.selectorsChecked,
        },
      };
    }

    return statuses;
  };
}
