import { describe, expect, it } from "bun:test";

import type {
  DescribeStackResourcesCommand,
  DescribeStackResourcesCommandOutput,
  StackResource,
} from "@aws-sdk/client-cloudformation";
import type { GetCallerIdentityCommand, GetCallerIdentityCommandOutput } from "@aws-sdk/client-sts";

import type { ResolverConfig } from "../index.ts";
import type { CloudFormationLike, StsLike } from "../src/resolveConfig.ts";
import { resolveStackResources } from "../src/resolveConfig.ts";

interface FakeCfn {
  readonly client: CloudFormationLike;
  readonly calls: Array<DescribeStackResourcesCommand>;
}

interface FakeSts {
  readonly client: StsLike;
  readonly calls: Array<GetCallerIdentityCommand>;
}

function stackResource(props: {
  readonly LogicalResourceId: string;
  readonly ResourceType: string;
  readonly PhysicalResourceId: string;
}): StackResource {
  return {
    ...props,
    Timestamp: new Date(0),
    ResourceStatus: "CREATE_COMPLETE",
  };
}

function makeCfn(stackResources: ReadonlyArray<StackResource>): FakeCfn {
  const calls: Array<DescribeStackResourcesCommand> = [];
  const client: CloudFormationLike = {
    send(command) {
      calls.push(command);
      const output: DescribeStackResourcesCommandOutput = {
        StackResources: [...stackResources],
        $metadata: {},
      };
      return Promise.resolve(output);
    },
  };
  return { client, calls };
}

function makeSts(account: string): FakeSts {
  const calls: Array<GetCallerIdentityCommand> = [];
  const client: StsLike = {
    send(command) {
      calls.push(command);
      const output: GetCallerIdentityCommandOutput = { Account: account, $metadata: {} };
      return Promise.resolve(output);
    },
  };
  return { client, calls };
}

const baseConfig: ResolverConfig = {
  region: "eu-central-1",
  stackName: "example-stack",
  staticEnv: {},
};

async function captureError(operation: () => Promise<unknown>): Promise<Error> {
  try {
    await operation();
  } catch (caught) {
    if (caught instanceof Error) {
      return caught;
    }
    throw caught;
  }
  throw new Error("expected the operation to throw");
}

describe("resolveStackResources happy path", () => {
  it("matches a resource by logical-id prefix and type, with no STS call", async () => {
    const cfn = makeCfn([
      stackResource({
        LogicalResourceId: "Data666C94C7",
        ResourceType: "AWS::DynamoDB::Table",
        PhysicalResourceId: "stg-Data666C94C7-XYZ",
      }),
    ]);
    const sts = makeSts("111122223333");

    const resolved = await resolveStackResources({
      config: baseConfig,
      resources: [
        {
          envVar: "DATA_TABLE_NAME",
          logicalIdPrefix: "Data",
          resourceType: "AWS::DynamoDB::Table",
        },
      ],
      cfnClient: cfn.client,
      stsClient: sts.client,
    });

    expect(resolved).toEqual({ DATA_TABLE_NAME: "stg-Data666C94C7-XYZ" });
    expect(cfn.calls).toHaveLength(1);
    expect(sts.calls).toHaveLength(0);
  });
});

describe("resolveStackResources missing resource", () => {
  it("throws naming both the env var and the logical-id prefix", async () => {
    const cfn = makeCfn([
      stackResource({
        LogicalResourceId: "Other123",
        ResourceType: "AWS::S3::Bucket",
        PhysicalResourceId: "some-bucket",
      }),
    ]);

    const error = await captureError(() =>
      resolveStackResources({
        config: baseConfig,
        resources: [{ envVar: "DATA_TABLE_NAME", logicalIdPrefix: "Data" }],
        cfnClient: cfn.client,
      }),
    );

    expect(error.message).toContain("DATA_TABLE_NAME");
    expect(error.message).toContain("Data");
    expect(error.message).toContain("example-stack");
  });
});

describe("resolveStackResources function transform", () => {
  it("applies a function transform using the provided accountId without calling STS", async () => {
    const cfn = makeCfn([
      stackResource({
        LogicalResourceId: "SdkHandlerAB12CD34",
        ResourceType: "AWS::Lambda::Function",
        PhysicalResourceId: "stg-SdkHandler-abc",
      }),
    ]);
    const sts = makeSts("111122223333");

    const resolved = await resolveStackResources({
      config: { ...baseConfig, accountId: "999988887777" },
      resources: [
        {
          envVar: "SDK_HANDLER_ARN",
          logicalIdPrefix: "SdkHandler",
          resourceType: "AWS::Lambda::Function",
          transform: (name, { region, accountId }) =>
            `arn:aws:lambda:${region}:${accountId}:function:${name}`,
        },
      ],
      cfnClient: cfn.client,
      stsClient: sts.client,
    });

    expect(resolved).toEqual({
      SDK_HANDLER_ARN: "arn:aws:lambda:eu-central-1:999988887777:function:stg-SdkHandler-abc",
    });
    expect(sts.calls).toHaveLength(0);
  });
});

describe("resolveStackResources tag transform", () => {
  it("builds the lambda ARN and resolves accountId via STS exactly once", async () => {
    const cfn = makeCfn([
      stackResource({
        LogicalResourceId: "SdkHandlerAB12CD34",
        ResourceType: "AWS::Lambda::Function",
        PhysicalResourceId: "stg-SdkHandler-abc",
      }),
      stackResource({
        LogicalResourceId: "WorkerHandlerEF56GH78",
        ResourceType: "AWS::Lambda::Function",
        PhysicalResourceId: "stg-WorkerHandler-def",
      }),
    ]);
    const sts = makeSts("111122223333");

    const resolved = await resolveStackResources({
      config: baseConfig,
      resources: [
        {
          envVar: "SDK_HANDLER_ARN",
          logicalIdPrefix: "SdkHandler",
          resourceType: "AWS::Lambda::Function",
          transform: { kind: "lambdaArn" },
        },
        {
          envVar: "WORKER_HANDLER_ARN",
          logicalIdPrefix: "WorkerHandler",
          resourceType: "AWS::Lambda::Function",
          transform: { kind: "lambdaArn" },
        },
      ],
      cfnClient: cfn.client,
      stsClient: sts.client,
    });

    expect(resolved).toEqual({
      SDK_HANDLER_ARN: "arn:aws:lambda:eu-central-1:111122223333:function:stg-SdkHandler-abc",
      WORKER_HANDLER_ARN: "arn:aws:lambda:eu-central-1:111122223333:function:stg-WorkerHandler-def",
    });
    expect(sts.calls).toHaveLength(1);
  });
});

describe("resolveStackResources resourceType filter", () => {
  it("chooses the resource whose type matches when a prefix is shared", async () => {
    const cfn = makeCfn([
      stackResource({
        LogicalResourceId: "DataPolicy11111111",
        ResourceType: "AWS::IAM::Policy",
        PhysicalResourceId: "data-policy",
      }),
      stackResource({
        LogicalResourceId: "Data666C94C7",
        ResourceType: "AWS::DynamoDB::Table",
        PhysicalResourceId: "stg-Data666C94C7-XYZ",
      }),
    ]);

    const resolved = await resolveStackResources({
      config: baseConfig,
      resources: [
        {
          envVar: "DATA_TABLE_NAME",
          logicalIdPrefix: "Data",
          resourceType: "AWS::DynamoDB::Table",
        },
      ],
      cfnClient: cfn.client,
    });

    expect(resolved).toEqual({ DATA_TABLE_NAME: "stg-Data666C94C7-XYZ" });
  });
});

describe("resolveStackResources multiple stacks", () => {
  it("looks a mapping up only in its own stack and describes every stack", async () => {
    const byStack: Record<string, ReadonlyArray<StackResource>> = {
      "stack-a": [
        stackResource({
          LogicalResourceId: "Data1",
          ResourceType: "AWS::S3::Bucket",
          PhysicalResourceId: "bucket-a",
        }),
      ],
      "stack-b": [
        stackResource({
          LogicalResourceId: "Data1",
          ResourceType: "AWS::S3::Bucket",
          PhysicalResourceId: "bucket-b",
        }),
      ],
    };
    const client: CloudFormationLike = {
      send: async (command) => ({
        $metadata: {},
        StackResources: [...(byStack[command.input.StackName ?? ""] ?? [])],
      }),
    };

    const resolved = await resolveStackResources({
      config: { ...baseConfig, stackName: ["stack-a", "stack-b"] },
      resources: [
        { envVar: "A", logicalIdPrefix: "Data", stackName: "stack-a" },
        { envVar: "B", logicalIdPrefix: "Data", stackName: "stack-b" },
      ],
      cfnClient: client,
    });

    expect(resolved).toEqual({ A: "bucket-a", B: "bucket-b" });
  });
});
