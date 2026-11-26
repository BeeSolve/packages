import { afterEach, describe, expect, it, spyOn } from "bun:test";

import { keptActive, keptActiveStreaming } from "../runtime";
import { keepActivePing } from "../shared";

const streamingMarker = Symbol.for("aws.lambda.runtime.handler.streaming");
const ping = { [keepActivePing]: true };

interface FakeStream {
  chunks: Array<string>;
  write(chunk: string): void;
}

function fakeStream(): FakeStream {
  const chunks: Array<string> = [];
  return {
    chunks,
    write(chunk) {
      chunks.push(chunk);
    },
  };
}

afterEach(() => {
  process.removeAllListeners("warning");
});

describe("keptActive", () => {
  it("returns without calling the handler for a ping", async () => {
    let calls = 0;
    const handler = keptActive(async (event: unknown, context: string) => {
      calls++;
      return { event, context };
    });

    expect(handler(ping, "context")).toBeUndefined();
    expect(calls).toBe(0);
  });

  it("passes other events and the context through", async () => {
    const handler = keptActive(async (event: { id: number }, context: string) => ({
      id: event.id,
      context,
    }));

    expect(await handler({ id: 1 }, "context")).toEqual({ id: 1, context: "context" });
  });

  it("rejects with the handler error", async () => {
    const handler = keptActive(async (_event: unknown, _context: unknown) => {
      throw new Error("boom");
    });

    const error = await Promise.resolve(handler({}, {})).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error instanceof Error && error.message).toBe("boom");
  });

  it("does not treat lookalike events as pings", async () => {
    const handler = keptActive(async (event: unknown, _context: unknown) => ({ seen: event }));

    for (const event of [
      { [keepActivePing]: "true" },
      { [keepActivePing]: false },
      {},
      null,
      "x",
    ]) {
      expect(await handler(event, {})).toEqual({ seen: event });
    }
  });

  it("logs the ping when logging is enabled", () => {
    const info = spyOn(console, "info").mockImplementation(() => undefined);
    const handler = keptActive(async (_event: unknown, _context: unknown) => "ok", {
      enableLogs: true,
    });

    void handler(ping, {});

    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]?.[0]).toContain("Keep active ping");
    info.mockRestore();
  });

  it("stays silent by default", () => {
    const info = spyOn(console, "info").mockImplementation(() => undefined);
    const handler = keptActive(async (_event: unknown, _context: unknown) => "ok");

    void handler(ping, {});

    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });
});

describe("keptActiveStreaming", () => {
  function streamified() {
    const inner = async (
      event: Record<string, unknown>,
      responseStream: FakeStream,
      context: string,
    ) => {
      responseStream.write(`${String(event.name)}:${context}`);
    };
    return Object.assign(inner, { [streamingMarker]: "response" });
  }

  it("returns without calling the handler or writing to the stream for a ping", async () => {
    const handler = keptActiveStreaming(streamified());
    const stream = fakeStream();

    expect(handler(ping, stream, "context")).toBeUndefined();
    expect(stream.chunks).toEqual([]);
  });

  it("passes event, stream and context to the handler", async () => {
    const handler = keptActiveStreaming(streamified());
    const stream = fakeStream();

    await handler({ name: "cat" }, stream, "ctx");

    expect(stream.chunks).toEqual(["cat:ctx"]);
  });

  it("keeps the streaming marker so the runtime still streams", () => {
    const handler = keptActiveStreaming(streamified());

    expect(Reflect.get(handler, streamingMarker)).toBe("response");
  });

  it("keeps the marker for a handler wrapped by a streamify function", () => {
    const streamifyResponse = <Handler extends object>(fn: Handler) =>
      Object.assign(fn, { [streamingMarker]: "response" });
    const handler = keptActiveStreaming(
      streamifyResponse(async (_event: unknown, _stream: FakeStream, _context: unknown) => {}),
    );

    expect(Reflect.get(handler, streamingMarker)).toBe("response");
  });

  it("does not add a marker to a handler without one", () => {
    const handler = keptActiveStreaming(
      async (_event: unknown, _stream: FakeStream, _context: unknown) => {},
    );

    expect(Reflect.get(handler, streamingMarker)).toBeUndefined();
  });

  it("logs the ping when logging is enabled", () => {
    const info = spyOn(console, "info").mockImplementation(() => undefined);
    const handler = keptActiveStreaming(streamified(), { enableLogs: true });

    void handler(ping, fakeStream(), "context");

    expect(info).toHaveBeenCalledTimes(1);
    info.mockRestore();
  });

  it("rejects with the handler error", async () => {
    const handler = keptActiveStreaming(
      async (_event: unknown, _stream: FakeStream, _context: unknown) => {
        throw new Error("boom");
      },
    );

    const error = await Promise.resolve(handler({}, fakeStream(), "context")).catch(
      (caught: unknown) => caught,
    );

    expect(error instanceof Error && error.message).toBe("boom");
  });
});
