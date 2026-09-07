import { resolveDomainDns } from "../dns.ts";
import type { Domains } from "../domain.ts";
import type { JobRuns } from "../jobRuns.ts";
import { withJobFailure } from "./withJobFailure.ts";

export async function runDnsRefresh(props: {
  readonly domains: Pick<Domains, "getByDomain" | "putDns">;
  readonly jobs: Pick<JobRuns, "completeRun" | "failRun">;
  readonly domain: string;
  readonly runId: string;
}): Promise<void> {
  await withJobFailure({ jobs: props.jobs, domain: props.domain, runId: props.runId }, async () => {
    const record = await props.domains.getByDomain({ domain: props.domain });
    const dkimSelectors = record?.selectors != null ? Array.from(record.selectors) : [];

    const dns = await resolveDomainDns({ domain: props.domain, dkimSelectors });

    await props.domains.putDns({ domain: props.domain, dns });

    await props.jobs.completeRun({
      domain: props.domain,
      runId: props.runId,
      counts: { selectorsChecked: dkimSelectors.length },
    });
  });
}
