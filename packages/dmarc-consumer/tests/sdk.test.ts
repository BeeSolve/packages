import { beforeEach, describe, expect, it, mock } from "bun:test";

import type { BackfillConfig, BackfillStatus } from "../backfill.ts";

process.env.TABLE_NAME = "test-table";
process.env.BEESOLVE_TASKS_MAIN_QUEUE_URL = "https://sqs.test/queue";

const startRun = mock(
  (_props: { readonly domain: string; readonly runId: string; readonly startedAt: string }) =>
    Promise.resolve(),
);
const completeRun = mock(
  (_props: {
    readonly domain: string;
    readonly runId: string;
    readonly ipsEnriched: number;
    readonly reportsScanned: number;
  }) => Promise.resolve(),
);
const failRun = mock(
  (_props: { readonly domain: string; readonly runId: string; readonly error: string }) =>
    Promise.resolve(),
);
const readConfig = mock((): Promise<BackfillConfig | null> => Promise.resolve(null));
const backfillDomain = mock((_props: { readonly domain: string; readonly runId: string }) =>
  Promise.resolve(),
);

const { deriveCanRun } = await import("../backfill.ts");

void mock.module("../backfill.ts", () => ({
  Backfill: class {
    readonly startRun = startRun;
    readonly completeRun = completeRun;
    readonly failRun = failRun;
    readonly readConfig = readConfig;
  },
  deriveCanRun,
}));

void mock.module("../src/tasks.ts", () => ({
  tasks: { backfillDomain },
}));

const { BackfillSdk } = await import("../sdk.ts");

function transactionCanceled(): Error {
  const error = new Error("Transaction cancelled");
  error.name = "TransactionCanceledException";
  return error;
}

function configWith(domain: string, status: BackfillStatus): BackfillConfig {
  return {
    pk: "system#config",
    sk: "ipBackfill",
    domains: {
      [domain]: {
        status,
        runId: "run-1",
        startedAt: "2024-01-01T00:00:00.000Z",
        finishedAt: status === "finished" ? "2024-01-01T00:05:00.000Z" : undefined,
        ipsEnriched: status === "finished" ? 7 : undefined,
      },
    },
  };
}

beforeEach(() => {
  startRun.mockReset();
  completeRun.mockReset();
  failRun.mockReset();
  readConfig.mockReset();
  backfillDomain.mockReset();
  startRun.mockImplementation(() => Promise.resolve());
  completeRun.mockImplementation(() => Promise.resolve());
  failRun.mockImplementation(() => Promise.resolve());
  readConfig.mockImplementation(() => Promise.resolve(null));
  backfillDomain.mockImplementation(() => Promise.resolve());
});

describe("BackfillSdk", () => {
  describe("start", () => {
    it("writes started via the model transaction and then enqueues with the generated runId", async () => {
      const sdk = new BackfillSdk();

      const result = await sdk.start({ domain: "example.com" });

      expect(result.enqueued).toBe(true);
      if (!result.enqueued) throw new Error("expected enqueued result");

      expect(startRun).toHaveBeenCalledTimes(1);
      expect(startRun.mock.calls[0]?.[0]).toMatchObject({
        domain: "example.com",
        runId: result.runId,
      });

      expect(backfillDomain).toHaveBeenCalledTimes(1);
      expect(backfillDomain.mock.calls[0]?.[0]).toEqual({
        domain: "example.com",
        runId: result.runId,
      });
    });

    it("returns already-running when the transaction is cancelled and does not enqueue", async () => {
      startRun.mockImplementationOnce(() => Promise.reject(transactionCanceled()));
      const sdk = new BackfillSdk();

      const result = await sdk.start({ domain: "example.com" });

      expect(result).toEqual({ enqueued: false, reason: "already-running" });
      expect(backfillDomain).not.toHaveBeenCalled();
    });

    it("propagates non-cancellation errors and does not enqueue", async () => {
      startRun.mockImplementationOnce(() => Promise.reject(new Error("boom")));
      const sdk = new BackfillSdk();

      let thrown: unknown;
      try {
        await sdk.start({ domain: "example.com" });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect(thrown instanceof Error ? thrown.message : "").toBe("boom");
      expect(backfillDomain).not.toHaveBeenCalled();
    });
  });

  describe("getStatuses", () => {
    it("returns an empty record when the config is not found", async () => {
      readConfig.mockResolvedValueOnce(null);
      const sdk = new BackfillSdk();

      const result = await sdk.getStatuses();

      expect(result).toEqual({});
      expect(readConfig).toHaveBeenCalledTimes(1);
    });

    it("gates a started domain to canRun false with a lastRun summary", async () => {
      readConfig.mockResolvedValueOnce(configWith("busy.com", "started"));
      const sdk = new BackfillSdk();

      const result = await sdk.getStatuses();

      expect(result).toEqual({
        "busy.com": {
          canRun: false,
          lastRun: {
            status: "started",
            startedAt: "2024-01-01T00:00:00.000Z",
            finishedAt: undefined,
            ipsEnriched: undefined,
          },
        },
      });
    });

    it("returns canRun true with a lastRun summary for a finished domain", async () => {
      readConfig.mockResolvedValueOnce(configWith("done.com", "finished"));
      const sdk = new BackfillSdk();

      const result = await sdk.getStatuses();

      expect(result).toEqual({
        "done.com": {
          canRun: true,
          lastRun: {
            status: "finished",
            startedAt: "2024-01-01T00:00:00.000Z",
            finishedAt: "2024-01-01T00:05:00.000Z",
            ipsEnriched: 7,
          },
        },
      });
    });
  });

  describe("complete / fail", () => {
    it("delegates complete to the model", async () => {
      const sdk = new BackfillSdk();

      await sdk.complete({
        domain: "example.com",
        runId: "run-1",
        ipsEnriched: 3,
        reportsScanned: 9,
      });

      expect(completeRun).toHaveBeenCalledTimes(1);
      expect(completeRun.mock.calls[0]?.[0]).toEqual({
        domain: "example.com",
        runId: "run-1",
        ipsEnriched: 3,
        reportsScanned: 9,
      });
    });

    it("delegates fail to the model", async () => {
      const sdk = new BackfillSdk();

      await sdk.fail({ domain: "example.com", runId: "run-1", error: "nope" });

      expect(failRun).toHaveBeenCalledTimes(1);
      expect(failRun.mock.calls[0]?.[0]).toEqual({
        domain: "example.com",
        runId: "run-1",
        error: "nope",
      });
    });
  });
});
