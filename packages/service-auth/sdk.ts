import {
  InvocationType,
  InvokeCommand,
  LambdaClient,
} from "@aws-sdk/client-lambda";
import { encodeToStringifiable } from "@beesolve/helpers";
import * as v from "valibot";
import type {
  Commands,
  RequestByType,
  ResponseByType,
  Types,
} from "./sdkHandler.ts";

const envSchema = v.object({
  BEESOLVE_AUTH_SDK_HANDLER_ARN: v.string(),
});
const env = v.parse(envSchema, process.env);

export class AuthClient {
  private readonly lambdaArn: string;
  private readonly lambdaClient: LambdaClient;

  constructor(
    readonly props: {
      readonly lambdaArn?: string;
      readonly lambdaClient?: LambdaClient;
    } = {},
  ) {
    this.lambdaArn = props.lambdaArn ?? env.BEESOLVE_AUTH_SDK_HANDLER_ARN;
    this.lambdaClient = props.lambdaClient ?? new LambdaClient();
  }

  readonly invoke = async <const T extends Types<Commands>>(request: {
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

    return raw as Response;
  };
}
