import { resolve } from "node:path";

import { AuthGateway } from "@beesolve/auth-service/cdk";
import { EmailAlarms } from "@beesolve/cdk-email-alarms";
import type { App, StackProps } from "aws-cdk-lib";
import { Fn, Stack } from "aws-cdk-lib";
import type { CfnDistribution } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { InvokeMode } from "aws-cdk-lib/aws-lambda";
import { SvelteKit } from "kit-on-lambda/cdk";

/**
 * Demonstrates the authorizer + ensureCookieFunction pattern with caching disabled.
 *
 * Key concepts:
 * - `createSessionHandle()` in hooks reads session from the Lambda authorizer context (not DynamoDB)
 * - `auth.addAuthorizedEndpoint()` registers the handler behind the HTTP API authorizer
 * - `auth.ensureCookieFunction` injects a placeholder cookie so the authorizer identity source always resolves
 * - `authorizerCache: "disabled"` means every request hits the authorizer — no stale sessions
 * - No EventBridge consumer, no real email delivery — uses dev code (000000)
 */
export class CookieFunctionStack extends Stack {
  constructor(scope: App, id: string, props: StackProps) {
    super(scope, id, props);

    const emailAddress = process.env.SAMPLES_EMAIL_ADDRESS;
    const frontendUri = process.env.SAMPLES_AUTH_COOKIE_FUNCTION_FRONTEND_URI;

    if (emailAddress == null || frontendUri == null) {
      throw new Error(
        "SAMPLES_EMAIL_ADDRESS and SAMPLES_AUTH_COOKIE_FUNCTION_FRONTEND_URI must be set (see mise.toml)",
      );
    }

    const alarms = new EmailAlarms(this, "Alarms", {
      emailAddress,
    });

    // authorizerCache: "disabled" removes identitySource from the authorizer configuration.
    // This means the authorizer Lambda runs on every request, regardless of whether cookies
    // are present. Without this, API Gateway would reject requests missing the identity source
    // header before the authorizer even runs.
    const auth = new AuthGateway(this, "Auth", {
      stage: "dev",
      frontendUri,
      allowSignUp: false,
      alarms,
      authorizerCache: "disabled",
    });

    const site = new SvelteKit(this, "Site", {
      runtime: "node",
      invokeMode: InvokeMode.BUFFERED,
      buildDirectory: resolve(__dirname, "./site/build"),
      toDefaultOrigin: ({ handler }) => {
        // Register the SvelteKit handler as an authorized endpoint.
        // The authorizer resolves the session and passes context to the Lambda.
        auth.addAuthorizedEndpoint({ lambda: handler, path: "/{proxy+}" });

        if (auth.api.url == null) throw Error(`Unexpected error - missing api url`);
        return new HttpOrigin(Fn.parseDomainName(auth.api.url));
      },
    });

    // Attach ensureCookieFunction to the default behavior via L1 escape hatch.
    //
    // Why this is needed: the authorizer's identity source includes `$request.cookies.__Host-SID`.
    // When a user visits for the first time (no cookies), CloudFront would normally forward the
    // request without that cookie. With authorizerCache: "disabled" this isn't strictly necessary
    // for the authorizer to run, but the cookie function ensures consistent behavior and is
    // required when caching is enabled.
    //
    // kit-on-lambda manages the default behavior internally, so we add the
    // function association on the underlying CfnDistribution.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const cfnDist = site.distribution.node.defaultChild as CfnDistribution;
    cfnDist.addPropertyOverride("DistributionConfig.DefaultCacheBehavior.FunctionAssociations", [
      {
        EventType: "viewer-request",
        FunctionARN: auth.ensureCookieFunction.functionArn,
      },
    ]);

    const authBehaviour = auth.createAuthBehavior(site.distribution);
    site.distribution.addBehavior("/auth/*", authBehaviour.origin, authBehaviour);
  }
}
