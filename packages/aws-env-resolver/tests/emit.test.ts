import { describe, expect, it } from "bun:test";

import * as v from "valibot";

import { buildEmittedConfig, emittedConfigSchema, stripCdkHash } from "../src/emit.ts";
import type { BuildEmittedConfigProps } from "../src/emit.ts";

const base: Omit<BuildEmittedConfigProps, "entries"> = {
  projectName: "example-app",
  stackName: "example-stack",
  region: "eu-central-1",
};

describe("stripCdkHash", () => {
  it("strips a trailing 8 uppercase hex suffix", () => {
    expect(stripCdkHash("Data666C94C7")).toBe("Data");
  });

  it("keeps ids without a hash suffix", () => {
    expect(stripCdkHash("Data")).toBe("Data");
  });

  it("strips only the final hash from multi-segment ids", () => {
    expect(stripCdkHash("ApiHandlerServiceRoleAB12CD34")).toBe("ApiHandlerServiceRole");
  });

  it("keeps a bare 8-hex id unchanged", () => {
    expect(stripCdkHash("AB12CD34")).toBe("AB12CD34");
  });

  it("does not strip lowercase hex", () => {
    expect(stripCdkHash("Dataab12cd34")).toBe("Dataab12cd34");
  });
});

describe("buildEmittedConfig", () => {
  it("maps a Ref to a logical id prefix", () => {
    const config = buildEmittedConfig({
      ...base,
      entries: [{ envVar: "DATA_TABLE_NAME", value: { intrinsic: { Ref: "Data666C94C7" } } }],
    });
    expect(config.resources).toEqual([{ envVar: "DATA_TABLE_NAME", logicalIdPrefix: "Data" }]);
  });

  it("maps GetAtt Arn to a prefix with the lambdaArn tag", () => {
    const config = buildEmittedConfig({
      ...base,
      entries: [
        {
          envVar: "SDK_HANDLER_ARN",
          value: { intrinsic: { "Fn::GetAtt": ["SdkHandlerAB12CD34", "Arn"] } },
        },
      ],
    });
    expect(config.resources).toEqual([
      {
        envVar: "SDK_HANDLER_ARN",
        logicalIdPrefix: "SdkHandler",
        transform: { kind: "lambdaArn" },
      },
    ]);
  });

  it("routes literals to staticEnv", () => {
    const config = buildEmittedConfig({
      ...base,
      entries: [{ envVar: "BASE_URI", value: "https://example.test" }],
    });
    expect(config.config.staticEnv).toEqual({ BASE_URI: "https://example.test" });
    expect(config.resources).toEqual([]);
  });

  it("collapses identical duplicates", () => {
    const entry = { envVar: "DATA_TABLE_NAME", value: { intrinsic: { Ref: "Data666C94C7" } } };
    const config = buildEmittedConfig({ ...base, entries: [entry, entry] });
    expect(config.resources).toHaveLength(1);
  });

  it("throws on conflicting duplicates naming the env var", () => {
    expect(() =>
      buildEmittedConfig({
        ...base,
        entries: [
          { envVar: "DATA_TABLE_NAME", value: { intrinsic: { Ref: "Data666C94C7" } } },
          { envVar: "DATA_TABLE_NAME", value: { intrinsic: { Ref: "Other666C94C7" } } },
        ],
      }),
    ).toThrow(/DATA_TABLE_NAME.*"Data".*"Other"/);
  });

  it("throws on a literal conflicting with a token", () => {
    expect(() =>
      buildEmittedConfig({
        ...base,
        entries: [
          { envVar: "DATA_TABLE_NAME", value: "literal" },
          { envVar: "DATA_TABLE_NAME", value: { intrinsic: { Ref: "Data666C94C7" } } },
        ],
      }),
    ).toThrow(/DATA_TABLE_NAME/);
  });

  it("throws on unsupported intrinsics naming the env var", () => {
    expect(() =>
      buildEmittedConfig({
        ...base,
        entries: [{ envVar: "QUEUE_URL", value: { intrinsic: { "Fn::Join": ["", ["a", "b"]] } } }],
      }),
    ).toThrow(/QUEUE_URL.*"Fn::Join".*not support.*staticEnv.*intrinsicRules/);
  });

  it("throws on pseudo parameter refs", () => {
    expect(() =>
      buildEmittedConfig({
        ...base,
        entries: [{ envVar: "REGION", value: { intrinsic: { Ref: "AWS::Region" } } }],
      }),
    ).toThrow(/REGION/);
  });

  it("throws on non-Arn GetAtt attributes", () => {
    expect(() =>
      buildEmittedConfig({
        ...base,
        entries: [
          {
            envVar: "TABLE_STREAM",
            value: { intrinsic: { "Fn::GetAtt": ["Data666C94C7", "StreamArn"] } },
          },
        ],
      }),
    ).toThrow(/TABLE_STREAM.*StreamArn/);
  });

  it("passes secrets through and lets them win over walked entries", () => {
    const config = buildEmittedConfig({
      ...base,
      entries: [
        { envVar: "API_KEY", value: { intrinsic: { Ref: "ApiKey666C94C7" } } },
        { envVar: "BASE_URI", value: "https://example.test" },
      ],
      secrets: [{ secretId: "example/secrets", envVars: ["API_KEY", "HMAC_SECRET"] }],
    });
    expect(config.config.secretId).toBe("example/secrets");
    expect(config.secrets).toEqual([{ envVar: "API_KEY" }, { envVar: "HMAC_SECRET" }]);
    expect(config.resources).toEqual([]);
    expect(config.config.staticEnv).toEqual({ BASE_URI: "https://example.test" });
  });

  it("lets the staticEnv prop override walked literals", () => {
    const config = buildEmittedConfig({
      ...base,
      entries: [{ envVar: "BASE_URI", value: "https://deployed.example.test" }],
      staticEnv: { BASE_URI: "https://local.example.test", EXTRA: "1" },
    });
    expect(config.config.staticEnv).toEqual({
      BASE_URI: "https://local.example.test",
      EXTRA: "1",
    });
  });

  it("throws on more than one distinct secretId", () => {
    expect(() =>
      buildEmittedConfig({
        ...base,
        entries: [],
        secrets: [
          { secretId: "example/a", envVars: ["A"] },
          { secretId: "example/b", envVars: ["B"] },
        ],
      }),
    ).toThrow(/secretId.*example\/a.*example\/b/);
  });

  it("produces output that satisfies the emitted config schema", () => {
    const config = buildEmittedConfig({
      ...base,
      profile: "example-profile",
      entries: [
        { envVar: "DATA_TABLE_NAME", value: { intrinsic: { Ref: "Data666C94C7" } } },
        { envVar: "BASE_URI", value: "https://example.test" },
      ],
      secrets: [{ secretId: "example/secrets", envVars: ["API_KEY"] }],
    });
    expect(v.parse(emittedConfigSchema, config)).toEqual(config);
    expect(config.config.profile).toBe("example-profile");
  });
});
