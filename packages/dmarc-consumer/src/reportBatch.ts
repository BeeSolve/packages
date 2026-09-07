import { dmarcRecordSchema } from "@beesolve/dmarc-parser";
import type { DmarcReport } from "@beesolve/dmarc-reports";
import * as v from "valibot";

import type { Domains } from "../domain.ts";
import type { IpInfoCache } from "../ipInfo.ts";
import type { Reports } from "../report.ts";
import type { AdminSdk } from "../sdk.ts";

export interface ReportBatchDeps {
  readonly reports: Pick<Reports, "persist">;
  readonly domains: Pick<Domains, "upsert" | "addSelectors">;
  readonly ipInfoCache: Pick<IpInfoCache, "enrichMany">;
  readonly adminSdk: Pick<AdminSdk, "startDnsRefresh">;
}

/**
 * Runs the post-persist pipeline for a batch of parsed DMARC reports:
 * persists the reports, upserts domain aggregates, enriches source IPs,
 * persists observed DKIM selectors, and bootstraps a DNS refresh for newly
 * created domains. All dependencies are injected so this runs without any live
 * AWS clients. When persistence fails, `persistFailed` is `true` and no
 * downstream steps run, mirroring the handler's total-failure behavior.
 */
export async function processReportBatch(
  props: ReportBatchDeps & { readonly parsedReports: Array<DmarcReport> },
): Promise<{ persistFailed: boolean }> {
  try {
    await props.reports.persist({ reports: props.parsedReports });
  } catch (error) {
    console.error("Failed to persist reports to DynamoDB:", error);
    return { persistFailed: true };
  }

  const createdDomains = await upsertDomainAggregates({
    domains: props.domains,
    parsedReports: props.parsedReports,
  });
  await enrichSourceIps({ ipInfoCache: props.ipInfoCache, parsedReports: props.parsedReports });
  await persistSelectors({ domains: props.domains, parsedReports: props.parsedReports });
  await bootstrapDns({ adminSdk: props.adminSdk, createdDomains });

  return { persistFailed: false };
}

async function upsertDomainAggregates(props: {
  readonly domains: Pick<Domains, "upsert">;
  readonly parsedReports: Array<DmarcReport>;
}): Promise<Set<string>> {
  const aggregates = new Map<
    string,
    { totalMessages: number; totalPass: number; totalFail: number }
  >();

  for (const report of props.parsedReports) {
    const domain = report.policyPublished.domain;
    const totalMessages = report.records.reduce((sum, record) => sum + record.count, 0);
    const totalFail = report.records
      .filter((record) => record.policyEvaluated.disposition !== "none")
      .reduce((sum, record) => sum + record.count, 0);
    const totalPass = totalMessages - totalFail;

    const existing = aggregates.get(domain);
    if (existing != null) {
      existing.totalMessages += totalMessages;
      existing.totalPass += totalPass;
      existing.totalFail += totalFail;
    } else {
      aggregates.set(domain, { totalMessages, totalPass, totalFail });
    }
  }

  const createdDomains = new Set<string>();
  for (const [domain, totals] of aggregates) {
    try {
      const { created } = await props.domains.upsert({ domain, ...totals });
      if (created) createdDomains.add(domain);
    } catch (error) {
      console.error(`Failed to upsert domain aggregate for ${domain}:`, error);
    }
  }

  return createdDomains;
}

async function bootstrapDns(props: {
  readonly adminSdk: Pick<AdminSdk, "startDnsRefresh">;
  readonly createdDomains: Set<string>;
}): Promise<void> {
  for (const domain of props.createdDomains) {
    try {
      await props.adminSdk.startDnsRefresh({ domain });
    } catch (error) {
      console.error(`Failed to bootstrap DNS refresh for ${domain}:`, error);
    }
  }
}

async function enrichSourceIps(props: {
  readonly ipInfoCache: Pick<IpInfoCache, "enrichMany">;
  readonly parsedReports: Array<DmarcReport>;
}): Promise<void> {
  const ips = new Set<string>();
  for (const report of props.parsedReports) {
    for (const rawRecord of report.records) {
      const parsed = v.safeParse(dmarcRecordSchema, rawRecord);
      if (parsed.success) {
        ips.add(parsed.output.sourceIp);
      }
    }
  }

  if (ips.size === 0) return;

  try {
    await props.ipInfoCache.enrichMany({ ips: Array.from(ips) });
  } catch (error) {
    console.error("Failed to enrich source IPs:", error);
  }
}

async function persistSelectors(props: {
  readonly domains: Pick<Domains, "addSelectors">;
  readonly parsedReports: Array<DmarcReport>;
}): Promise<void> {
  const selectorsByDomain = new Map<string, Set<string>>();

  for (const report of props.parsedReports) {
    const domain = report.policyPublished.domain;
    for (const rawRecord of report.records) {
      const parsed = v.safeParse(dmarcRecordSchema, rawRecord);
      if (!parsed.success) continue;
      for (const dkimResult of parsed.output.authResults.dkim) {
        if (dkimResult.selector == null || dkimResult.selector === "") continue;
        const existing = selectorsByDomain.get(domain);
        if (existing != null) {
          existing.add(dkimResult.selector);
        } else {
          selectorsByDomain.set(domain, new Set([dkimResult.selector]));
        }
      }
    }
  }

  for (const [domain, selectors] of selectorsByDomain) {
    try {
      await props.domains.addSelectors({ domain, selectors: Array.from(selectors) });
    } catch (error) {
      console.error(`Failed to persist DKIM selectors for ${domain}:`, error);
    }
  }
}
