import { dmarcRecordSchema } from "@beesolve/dmarc-parser";
import * as v from "valibot";

import type { Backfill } from "../backfill.ts";
import type { IpInfoCache } from "../ipInfo.ts";
import type { Reports } from "../report.ts";

export async function runBackfill(props: {
  readonly reports: Pick<Reports, "queryByDomain">;
  readonly ipInfoCache: Pick<IpInfoCache, "enrichMany">;
  readonly backfill: Pick<Backfill, "completeRun" | "failRun">;
  readonly domain: string;
  readonly runId: string;
}): Promise<void> {
  try {
    const uniqueIps = new Set<string>();
    let reportsScanned = 0;
    let cursor: string | undefined;

    do {
      const page = await props.reports.queryByDomain({ domain: props.domain, cursor });

      for (const report of page.reports) {
        reportsScanned += 1;
        for (const rawRecord of report.records) {
          const parsed = v.safeParse(dmarcRecordSchema, rawRecord);
          if (parsed.success) {
            uniqueIps.add(parsed.output.sourceIp);
          }
        }
      }

      cursor = page.cursor;
    } while (cursor != null);

    const enriched = await props.ipInfoCache.enrichMany({ ips: Array.from(uniqueIps) });

    await props.backfill.completeRun({
      domain: props.domain,
      runId: props.runId,
      ipsEnriched: Object.keys(enriched).length,
      reportsScanned,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await props.backfill.failRun({ domain: props.domain, runId: props.runId, error: message });
    throw error;
  }
}
