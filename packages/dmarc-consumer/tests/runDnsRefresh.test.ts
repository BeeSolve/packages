import { beforeEach, describe, expect, it, mock } from "bun:test";

import type { Domain } from "../domain.ts";

const resolveTxtMock = mock<(hostname: string) => Promise<Array<Array<string>>>>();

void mock.module("node:dns/promises", () => ({
  resolveTxt: resolveTxtMock,
}));

const { runDnsRefresh } = await import("../src/runDnsRefresh.ts");

function domainRecord(props: { readonly selectors?: Array<string> }): Domain {
  return {
    pk: "domain#example.com",
    sk: "domain",
    domain: "example.com",
    totalMessages: 0,
    totalPass: 0,
    totalFail: 0,
    selectors: props.selectors != null ? new Set(props.selectors) : undefined,
  };
}

beforeEach(() => {
  resolveTxtMock.mockReset();
  resolveTxtMock.mockResolvedValue([["v=spf1 -all"]]);
});

describe("runDnsRefresh", () => {
  it("reads observed selectors from the domain record, resolves DNS, writes the cache, and completes", async () => {
    resolveTxtMock.mockImplementation((hostname: string) => {
      if (hostname === "example.com") return Promise.resolve([["v=spf1 include:x -all"]]);
      if (hostname === "_dmarc.example.com") return Promise.resolve([["v=DMARC1; p=reject"]]);
      if (hostname === "sel1._domainkey.example.com") return Promise.resolve([["k=rsa; p=AAAA"]]);
      return Promise.reject(nodeError("ENODATA"));
    });

    const getByDomain = mock((_props: { readonly domain: string }): Promise<Domain | null> =>
      Promise.resolve(domainRecord({ selectors: ["sel1", "sel2"] })),
    );
    const putDns = mock((_props: { readonly domain: string; readonly dns: unknown }) =>
      Promise.resolve(),
    );
    const completeRun = mock(
      (_props: {
        readonly domain: string;
        readonly runId: string;
        readonly counts?: { readonly selectorsChecked?: number };
      }) => Promise.resolve(),
    );
    const failRun = mock(
      (_props: { readonly domain: string; readonly runId: string; readonly error: string }) =>
        Promise.resolve(),
    );

    await runDnsRefresh({
      domains: { getByDomain, putDns },
      jobs: { completeRun, failRun },
      domain: "example.com",
      runId: "run-1",
    });

    expect(getByDomain).toHaveBeenCalledTimes(1);
    expect(putDns).toHaveBeenCalledTimes(1);
    expect(completeRun).toHaveBeenCalledTimes(1);
    expect(completeRun.mock.calls[0]?.[0]).toEqual({
      domain: "example.com",
      runId: "run-1",
      counts: { selectorsChecked: 2 },
    });
    expect(failRun).not.toHaveBeenCalled();
  });

  it("resolves with no selectors when the domain record has none", async () => {
    const getByDomain = mock((_props: { readonly domain: string }): Promise<Domain | null> =>
      Promise.resolve(domainRecord({})),
    );
    const putDns = mock((_props: { readonly domain: string; readonly dns: unknown }) =>
      Promise.resolve(),
    );
    const completeRun = mock(
      (_props: {
        readonly domain: string;
        readonly runId: string;
        readonly counts?: { readonly selectorsChecked?: number };
      }) => Promise.resolve(),
    );
    const failRun = mock(
      (_props: { readonly domain: string; readonly runId: string; readonly error: string }) =>
        Promise.resolve(),
    );

    await runDnsRefresh({
      domains: { getByDomain, putDns },
      jobs: { completeRun, failRun },
      domain: "example.com",
      runId: "run-1",
    });

    expect(putDns).toHaveBeenCalledTimes(1);
    expect(completeRun.mock.calls[0]?.[0]).toEqual({
      domain: "example.com",
      runId: "run-1",
      counts: { selectorsChecked: 0 },
    });
  });

  it("records a failure and rethrows when the domain read fails", async () => {
    const getByDomain = mock((_props: { readonly domain: string }): Promise<Domain | null> =>
      Promise.reject(new Error("read boom")),
    );
    const putDns = mock((_props: { readonly domain: string; readonly dns: unknown }) =>
      Promise.resolve(),
    );
    const completeRun = mock(
      (_props: {
        readonly domain: string;
        readonly runId: string;
        readonly counts?: { readonly selectorsChecked?: number };
      }) => Promise.resolve(),
    );
    const failRun = mock(
      (_props: { readonly domain: string; readonly runId: string; readonly error: string }) =>
        Promise.resolve(),
    );

    let caught: unknown;
    try {
      await runDnsRefresh({
        domains: { getByDomain, putDns },
        jobs: { completeRun, failRun },
        domain: "example.com",
        runId: "run-1",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught instanceof Error ? caught.message : null).toBe("read boom");
    expect(failRun).toHaveBeenCalledTimes(1);
    expect(putDns).not.toHaveBeenCalled();
    expect(completeRun).not.toHaveBeenCalled();
  });
});

function nodeError(code: string): Error {
  const error: Error & { code?: string } = new Error(code);
  error.code = code;
  return error;
}
