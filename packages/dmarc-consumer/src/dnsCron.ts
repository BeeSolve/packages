import * as v from "valibot";

import { isDnsStale } from "../dns.ts";
import { Domains } from "../domain.ts";
import { JobRuns } from "../jobRuns.ts";
import { beginRun } from "./beginRun.ts";
import { toDynamoClient } from "./dynamo.ts";
import { tasks } from "./tasks.ts";

const defaultTtlMs = 24 * 60 * 60 * 1000;

const env = v.parse(
  v.object({
    TABLE_NAME: v.string(),
    REVERSE_INDEX_NAME: v.string(),
    DNS_CACHE_TTL_MS: v.optional(v.string()),
  }),
  process.env,
);

const ttlMs = env.DNS_CACHE_TTL_MS != null ? Number(env.DNS_CACHE_TTL_MS) : defaultTtlMs;

const dynamo = toDynamoClient();
const domains = new Domains({
  dynamo,
  tableName: env.TABLE_NAME,
  reverseIndexName: env.REVERSE_INDEX_NAME,
});
const dnsRefresh = new JobRuns({ dynamo, tableName: env.TABLE_NAME, kind: "dnsRefresh" });

export async function handler(): Promise<void> {
  await enqueueStaleDomains({ domains, jobs: dnsRefresh, ttlMs });
}

export async function enqueueStaleDomains(props: {
  readonly domains: Pick<Domains, "list">;
  readonly jobs: Pick<JobRuns, "startRun">;
  readonly ttlMs: number;
}): Promise<void> {
  const allDomains = await props.domains.list();
  const staleDomains = allDomains.filter((domain) =>
    isDnsStale({ dns: domain.dns, ttlMs: props.ttlMs }),
  );

  for (const domain of staleDomains) {
    const result = await beginRun({ jobs: props.jobs, domain: domain.domain });
    if (result.started) {
      await tasks.refreshDomainDns({ domain: domain.domain, runId: result.runId });
    }
  }
}
