import { RemovalPolicy } from "aws-cdk-lib";
import type { OriginBase } from "aws-cdk-lib/aws-cloudfront";
import { FunctionUrlOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import type { Function as LambdaFunction } from "aws-cdk-lib/aws-lambda";
import { FunctionUrlAuthType, InvokeMode } from "aws-cdk-lib/aws-lambda";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";

import { originTokenEnvVar, originTokenHeader } from "./shared";

export interface ProtectedFunctionUrlOriginProps {
  readonly handler: LambdaFunction;
  /**
   * Invoke mode for the Function URL. Use `InvokeMode.RESPONSE_STREAM` for
   * streamed responses or `InvokeMode.BUFFERED` for buffered responses.
   *
   * @default InvokeMode.RESPONSE_STREAM
   */
  readonly invokeMode?: InvokeMode;
  /** CORS allowed origins for the Function URL. @default ["*"] */
  readonly allowedOrigins?: Array<string>;
}

/**
 * Creates a CloudFront origin for a Lambda Function URL protected by a shared
 * origin token. A secret token is generated, injected into the handler's
 * environment, and sent as a custom header from CloudFront so the handler can
 * reject any request that did not originate from this distribution.
 */
export function protectedFunctionUrlOrigin(props: ProtectedFunctionUrlOriginProps): OriginBase {
  const { handler, invokeMode = InvokeMode.RESPONSE_STREAM, allowedOrigins = ["*"] } = props;

  const originToken = new Secret(handler, "OriginToken", {
    description: "Origin token verifying CloudFront is the caller",
    removalPolicy: RemovalPolicy.DESTROY,
    generateSecretString: {
      passwordLength: 128,
      excludePunctuation: true,
    },
  }).secretValue.unsafeUnwrap();

  handler.addEnvironment(originTokenEnvVar, originToken);

  const url = handler.addFunctionUrl({
    authType: FunctionUrlAuthType.NONE,
    invokeMode,
    cors: { allowedOrigins },
  });

  return new FunctionUrlOrigin(url, {
    customHeaders: { [originTokenHeader]: originToken },
  });
}
