import { describe, expect, it } from "bun:test";

import { Config } from "../src/config.ts";

interface Sent {
  readonly name: string;
  readonly input: Record<string, unknown>;
}

function makeDynamo(options: { readonly throwConditional?: boolean } = {}) {
  const sends: Array<Sent> = [];
  const dynamo = {
    send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sends.push({ name: command.constructor.name, input: command.input });
      if (options.throwConditional === true) {
        const error = new Error("conditional failed");
        error.name = "ConditionalCheckFailedException";
        throw error;
      }
      return {};
    },
  };
  return { dynamo, sends };
}

describe("Config.ensureStart", () => {
  it("writes the start boundary with an earlier-or-absent condition", async () => {
    const { dynamo, sends } = makeDynamo();
    const config = new Config({ dynamo, tableName: "t" });

    await config.ensureStart({ hourKey: "2026-10-13-11" });

    expect(sends).toHaveLength(1);
    expect(sends[0]?.name).toBe("UpdateCommand");
    expect(sends[0]?.input.ConditionExpression).toBe(
      "attribute_not_exists(#startKey) OR :hourKey < #startKey",
    );
  });

  it("swallows a ConditionalCheckFailedException (start already earlier)", async () => {
    const { dynamo } = makeDynamo({ throwConditional: true });
    const config = new Config({ dynamo, tableName: "t" });

    const result = await config.ensureStart({ hourKey: "2026-10-13-11" });
    expect(result).toBeUndefined();
  });
});
