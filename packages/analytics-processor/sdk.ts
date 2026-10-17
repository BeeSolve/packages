import { InvocationType, InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { encodeToStringifiable } from "@beesolve/helpers";
import * as v from "valibot";

import type { Commands, RequestByType, ResponseByType, Types } from "./sdkHandler.ts";
import type { WatchMode, WatchSource, WatchStatus } from "./src/watch.ts";

const envSchema = v.object({
  BEESOLVE_ANALYTICS_SDK_HANDLER_ARN: v.string(),
});
const env = v.parse(envSchema, process.env);

export class AnalyticsClient {
  private readonly lambdaArn: string;
  private readonly lambdaClient: LambdaClient;

  constructor(
    readonly props: {
      readonly lambdaArn?: string;
      readonly lambdaClient?: LambdaClient;
    } = {},
  ) {
    this.lambdaArn = props.lambdaArn ?? env.BEESOLVE_ANALYTICS_SDK_HANDLER_ARN;
    this.lambdaClient = props.lambdaClient ?? new LambdaClient();
  }

  readonly updateSitemapUrl = async ({
    sitemapUrl,
  }: {
    readonly sitemapUrl: string;
  }): Promise<void> => {
    await this.invoke({ type: "updateSitemapUrl", request: { sitemapUrl } });
  };

  readonly upsertWatch = async ({
    matcher,
    mode,
    source,
    status,
    label,
  }: {
    readonly matcher: string;
    readonly mode: WatchMode;
    readonly source: WatchSource;
    readonly status?: WatchStatus;
    readonly label?: string;
  }): Promise<void> => {
    await this.invoke({
      type: "upsertWatch",
      request: { matcher, mode, source, status, label },
    });
  };

  readonly setWatchStatus = async ({
    matcher,
    status,
  }: {
    readonly matcher: string;
    readonly status: WatchStatus;
  }): Promise<void> => {
    await this.invoke({ type: "setWatchStatus", request: { matcher, status } });
  };

  readonly deleteWatch = async ({ matcher }: { readonly matcher: string }): Promise<void> => {
    await this.invoke({ type: "deleteWatch", request: { matcher } });
  };

  readonly syncSitemapNow = async (): Promise<void> => {
    await this.invoke({ type: "syncSitemapNow", request: {} });
  };

  private readonly invoke = async <const T extends Types<Commands>>(request: {
    request: RequestByType<T>;
    type: T;
  }): Promise<ResponseByType<T>> => {
    return this.invokeLambda(request);
  };

  private readonly invokeLambda = async <Request, Response>(
    request: Request,
  ): Promise<Response> => {
    const { Payload, StatusCode, FunctionError } = await this.lambdaClient.send(
      new InvokeCommand({
        FunctionName: this.lambdaArn,
        InvocationType: InvocationType.RequestResponse,
        Payload: JSON.stringify(encodeToStringifiable(request)),
      }),
    );

    if (StatusCode !== 200) {
      throw new Error(`Cannot invoke synchronous action: ${FunctionError}`);
    }

    const raw = JSON.parse(Payload?.transformToString() ?? "null");

    if (raw != null && typeof raw === "object" && "errorMessage" in raw) {
      throw new Error(`SDK handler error: ${raw.errorMessage}`);
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return raw as Response;
  };
}
