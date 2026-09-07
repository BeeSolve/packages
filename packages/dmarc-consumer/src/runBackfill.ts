import { dmarcRecordSchema } from "@beesolve/dmarc-parser";
import * as v from "valibot";

import type { IpInfoCache } from "../ipInfo.ts";
import type { JobRuns } from "../jobRuns.ts";
import type { Reports } from "../report.ts";
import { withJobFailure } from "./withJobFailure.ts";

export async function runBackfill(props: {
  readonly reports: Pick<Reports, "queryByDomain">;
  readonly ipInfoCache: Pick<IpInfoCache, "enrichMany">;
  readonly backfill: Pick<JobRuns, "completeRun" | "failRun">;
  readonly domain: string;
  readonly runId: string;
}): Promise<void> {
  await withJobFailure(
    { jobs: props.backfill, domain: props.domain, runId: props.runId },
    async () => {
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
        counts: { ipsEnriched: Object.keys(enriched).length, reportsScanned },
      });
    },
  );
}
