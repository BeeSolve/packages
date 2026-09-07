import { beforeEach, describe, expect, it, mock } from "bun:test";

import type { Domain } from "../domain.ts";

process.env.TABLE_NAME = "test-table";
process.env.REVERSE_INDEX_NAME = "reverse";

const refreshDomainDns = mock((_props: { readonly domain: string; readonly runId: string }) =>
  Promise.resolve(),
);

void mock.module("../src/tasks.ts", () => ({
  tasks: { refreshDomainDns },
}));

const { enqueueStaleDomains } = await import("../src/dnsCron.ts");

function domainRecord(props: { readonly domain: string; readonly fetchedAt?: string }): Domain {
  return {
    pk: `domain#${props.domain}`,
    sk: "domain",
    domain: props.domain,
    totalMessages: 0,
    totalPass: 0,
    totalFail: 0,
    dns: props.fetchedAt != null ? { fetchedAt: props.fetchedAt } : undefined,
  };
}

const ttlMs = 24 * 60 * 60 * 1000;

beforeEach(() => {
  refreshDomainDns.mockReset();
  refreshDomainDns.mockImplementation(() => Promise.resolve());
});

describe("enqueueStaleDomains", () => {
  it("enqueues a refresh only for stale and dns-missing domains", async () => {
    const fresh = domainRecord({ domain: "fresh.com", fetchedAt: new Date().toISOString() });
    const stale = domainRecord({ domain: "stale.com", fetchedAt: "2000-01-01T00:00:00.000Z" });
    const missing = domainRecord({ domain: "missing.com" });

    const list = mock((): Promise<Array<Domain>> => Promise.resolve([fresh, stale, missing]));
    const startRun = mock(() => Promise.resolve());

    await enqueueStaleDomains({ domains: { list }, jobs: { startRun }, ttlMs });

    expect(startRun).toHaveBeenCalledTimes(2);
    const enqueuedDomains = refreshDomainDns.mock.calls
      .map((call) => call[0]?.domain)
      .sort((left, right) => (left ?? "").localeCompare(right ?? ""));
    expect(enqueuedDomains).toEqual(["missing.com", "stale.com"]);
  });

  it("skips enqueue when the guarded start reports already-running", async () => {
    const stale = domainRecord({ domain: "stale.com", fetchedAt: "2000-01-01T00:00:00.000Z" });
    const list = mock((): Promise<Array<Domain>> => Promise.resolve([stale]));
    const startRun = mock(() => Promise.reject(alreadyRunning()));

    await enqueueStaleDomains({ domains: { list }, jobs: { startRun }, ttlMs });

    expect(refreshDomainDns).not.toHaveBeenCalled();
  });

  it("enqueues nothing when all domains are fresh", async () => {
    const fresh = domainRecord({ domain: "fresh.com", fetchedAt: new Date().toISOString() });
    const list = mock((): Promise<Array<Domain>> => Promise.resolve([fresh]));
    const startRun = mock(() => Promise.resolve());

    await enqueueStaleDomains({ domains: { list }, jobs: { startRun }, ttlMs });

    expect(startRun).not.toHaveBeenCalled();
    expect(refreshDomainDns).not.toHaveBeenCalled();
  });
});

function alreadyRunning(): Error {
  const error = new Error("Transaction cancelled");
  error.name = "TransactionCanceledException";
  Object.assign(error, {
    CancellationReasons: [{ Code: "ConditionalCheckFailed" }, { Code: "None" }],
  });
  return error;
}
