import { beforeEach, describe, expect, it, mock } from "bun:test";

process.env.TABLE_NAME = "test-table";
process.env.BEESOLVE_TASKS_MAIN_QUEUE_URL = "https://sqs.test/queue";

const send = mock((_command: unknown): Promise<unknown> => Promise.resolve({}));
const backfillDomain = mock((_props: { readonly domain: string; readonly runId: string }) =>
  Promise.resolve(),
);

void mock.module("../src/dynamo.ts", () => ({
  toDynamoClient: () => ({ send }),
}));

void mock.module("../src/tasks.ts", () => ({
  tasks: { backfillDomain },
}));

const { AdminSdk } = await import("../sdk.ts");

function transactionCanceled(): Error {
  const error = new Error("Transaction cancelled");
  error.name = "TransactionCanceledException";
  Object.assign(error, {
    CancellationReasons: [{ Code: "ConditionalCheckFailed" }, { Code: "None" }],
  });
  return error;
}

function validationCanceled(): Error {
  const error = new Error("Transaction cancelled");
  error.name = "TransactionCanceledException";
  Object.assign(error, { CancellationReasons: [{ Code: "ValidationError" }, { Code: "None" }] });
  return error;
}

function commandName(command: unknown): string {
  return command != null && typeof command === "object" ? command.constructor.name : "";
}

beforeEach(() => {
  send.mockReset();
  backfillDomain.mockReset();
  send.mockImplementation(() => Promise.resolve({}));
  backfillDomain.mockImplementation(() => Promise.resolve());
});

describe("AdminSdk", () => {
  describe("startIpBackfill", () => {
    it("writes started via the model transaction and then enqueues with the generated runId", async () => {
      const sdk = new AdminSdk();

      const result = await sdk.startIpBackfill({ domain: "example.com" });

      expect(result.enqueued).toBe(true);
      if (!result.enqueued) throw new Error("expected enqueued result");

      const transactCommand = send.mock.calls.find(
        (call) => commandName(call[0]) === "TransactWriteCommand",
      );
      expect(transactCommand).toBeDefined();

      expect(backfillDomain).toHaveBeenCalledTimes(1);
      expect(backfillDomain.mock.calls[0]?.[0]).toEqual({
        domain: "example.com",
        runId: result.runId,
      });
    });

    it("returns already-running when the transaction is cancelled and does not enqueue", async () => {
      send.mockImplementation((command: unknown) => {
        if (commandName(command) === "TransactWriteCommand") {
          return Promise.reject(transactionCanceled());
        }
        return Promise.resolve({});
      });
      const sdk = new AdminSdk();

      const result = await sdk.startIpBackfill({ domain: "example.com" });

      expect(result).toEqual({ enqueued: false, reason: "already-running" });
      expect(backfillDomain).not.toHaveBeenCalled();
    });

    it("propagates non-cancellation errors and does not enqueue", async () => {
      send.mockImplementation((command: unknown) => {
        if (commandName(command) === "TransactWriteCommand") {
          return Promise.reject(new Error("boom"));
        }
        return Promise.resolve({});
      });
      const sdk = new AdminSdk();

      let thrown: unknown;
      try {
        await sdk.startIpBackfill({ domain: "example.com" });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect(thrown instanceof Error ? thrown.message : "").toBe("boom");
      expect(backfillDomain).not.toHaveBeenCalled();
    });

    it("rethrows a cancelled transaction that is not a condition failure (e.g. validation)", async () => {
      send.mockImplementation((command: unknown) => {
        if (commandName(command) === "TransactWriteCommand") {
          return Promise.reject(validationCanceled());
        }
        return Promise.resolve({});
      });
      const sdk = new AdminSdk();

      let thrown: unknown;
      try {
        await sdk.startIpBackfill({ domain: "example.com" });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect(thrown instanceof Error ? thrown.name : "").toBe("TransactionCanceledException");
      expect(backfillDomain).not.toHaveBeenCalled();
    });
  });

  describe("startDnsRefresh", () => {
    it("performs the guarded start and returns the generated runId", async () => {
      const sdk = new AdminSdk();

      const result = await sdk.startDnsRefresh({ domain: "example.com" });

      expect(result.enqueued).toBe(true);
      if (!result.enqueued) throw new Error("expected enqueued result");

      const transactCommand = send.mock.calls.find(
        (call) => commandName(call[0]) === "TransactWriteCommand",
      );
      expect(transactCommand).toBeDefined();
    });

    it("returns already-running when the transaction is cancelled", async () => {
      send.mockImplementation((command: unknown) => {
        if (commandName(command) === "TransactWriteCommand") {
          return Promise.reject(transactionCanceled());
        }
        return Promise.resolve({});
      });
      const sdk = new AdminSdk();

      const result = await sdk.startDnsRefresh({ domain: "example.com" });

      expect(result).toEqual({ enqueued: false, reason: "already-running" });
    });
  });

  describe("getIpBackfillStatuses", () => {
    it("returns an empty record when the config is not found", async () => {
      send.mockImplementation(() => Promise.resolve({ Item: undefined }));
      const sdk = new AdminSdk();

      const result = await sdk.getIpBackfillStatuses();

      expect(result).toEqual({});
    });

    it("gates a started domain to canRun false with a lastRun summary", async () => {
      const startedAt = new Date().toISOString();
      send.mockImplementation(() =>
        Promise.resolve({
          Item: {
            pk: "system#config",
            sk: "ipBackfill",
            domains: { "busy.com": { status: "started", runId: "run-1", startedAt } },
          },
        }),
      );
      const sdk = new AdminSdk();

      const result = await sdk.getIpBackfillStatuses();

      expect(result).toEqual({
        "busy.com": {
          canRun: false,
          lastRun: {
            status: "started",
            startedAt,
            finishedAt: undefined,
            ipsEnriched: undefined,
            selectorsChecked: undefined,
          },
        },
      });
    });

    it("returns canRun true with a lastRun summary for a finished domain", async () => {
      send.mockImplementation(() =>
        Promise.resolve({
          Item: {
            pk: "system#config",
            sk: "ipBackfill",
            domains: {
              "done.com": {
                status: "finished",
                runId: "run-1",
                startedAt: "2024-01-01T00:00:00.000Z",
                finishedAt: "2024-01-01T00:05:00.000Z",
                ipsEnriched: 7,
              },
            },
          },
        }),
      );
      const sdk = new AdminSdk();

      const result = await sdk.getIpBackfillStatuses();

      expect(result).toEqual({
        "done.com": {
          canRun: true,
          lastRun: {
            status: "finished",
            startedAt: "2024-01-01T00:00:00.000Z",
            finishedAt: "2024-01-01T00:05:00.000Z",
            ipsEnriched: 7,
            selectorsChecked: undefined,
          },
        },
      });
    });
  });

  describe("getDnsRefreshStatuses", () => {
    it("returns an empty record when the config is not found", async () => {
      send.mockImplementation(() => Promise.resolve({ Item: undefined }));
      const sdk = new AdminSdk();

      const result = await sdk.getDnsRefreshStatuses();

      expect(result).toEqual({});
    });
  });
});
