import { describe, expect, it } from "bun:test";

import { spawnCommand } from "../src/spawn.ts";

describe("spawnCommand", () => {
  it("resolves to the child's exit code", async () => {
    const code = await spawnCommand({
      command: [process.execPath, "-e", "process.exit(3)"],
      env: {},
    });
    expect(code).toBe(3);
  });

  it("passes the merged env to the child", async () => {
    const code = await spawnCommand({
      command: [process.execPath, "-e", "process.exit(Number(process.env.EXAMPLE_EXIT_CODE))"],
      env: { EXAMPLE_EXIT_CODE: "7" },
    });
    expect(code).toBe(7);
  });

  it("rejects an empty command", async () => {
    expect(await captureErrorMessage()).toContain("non-empty command");
  });
});

async function captureErrorMessage(): Promise<string | undefined> {
  try {
    await spawnCommand({ command: [], env: {} });
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
