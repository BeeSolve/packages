import { resolveDomainDns } from "../dns.ts";
import type { Domains } from "../domain.ts";
import type { JobRuns } from "../jobRuns.ts";

export async function runDnsRefresh(props: {
  readonly domains: Pick<Domains, "getByDomain" | "putDns">;
  readonly jobs: Pick<JobRuns, "completeRun" | "failRun">;
  readonly domain: string;
  readonly runId: string;
}): Promise<void> {
  try {
    const record = await props.domains.getByDomain({ domain: props.domain });
    const dkimSelectors = record?.selectors != null ? Array.from(record.selectors) : [];

    const dns = await resolveDomainDns({ domain: props.domain, dkimSelectors });

    await props.domains.putDns({ domain: props.domain, dns });

    await props.jobs.completeRun({
      domain: props.domain,
      runId: props.runId,
      counts: { selectorsChecked: dkimSelectors.length },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await props.jobs.failRun({ domain: props.domain, runId: props.runId, error: message });
    throw error;
  }
}
