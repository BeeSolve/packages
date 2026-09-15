import { resolve } from "node:path";

import { AuthGateway } from "@beesolve/auth-service/cdk";
import { Nodejs24Function, StaticWebsite } from "@beesolve/cdk-constructs";
import type { App, StackProps } from "aws-cdk-lib";
import { Duration, Fn, Stack } from "aws-cdk-lib";
import {
  AllowedMethods,
  CachePolicy,
  FunctionEventType,
  OriginRequestPolicy,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { Rule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { Source } from "aws-cdk-lib/aws-s3-deployment";

/**
 * Demonstrates operator-less session impersonation with @beesolve/auth-service.
 *
 * Key concepts:
 * - Plain static SPA (single index.html) served via StaticWebsite (S3 + CloudFront)
 * - An authorized API Lambda behind `/api/*` protected by the session authorizer
 * - `POST /api/impersonate` calls the `impersonate` SDK command, forwarding the
 *   caller's own cookie header — the impersonator's session is mutated in place
 * - `grantSdkAccess` injects the SDK handler ARN so the API Lambda can invoke it
 * - The session authorizer exposes `impersonating` / `impersonatedBy` so the API
 *   can project the effective identity for the SPA
 * - `POST /auth/endImpersonation` (handled by the auth service) stops impersonation
 * - An EventBridge consumer audits `ImpersonationStarted` / `ImpersonationEnded`
 * - No email delivery — uses dev code (000000)
 */
export class ImpersonationStack extends Stack {
  constructor(scope: App, id: string, props: StackProps) {
    super(scope, id, props);

    const frontendUri = process.env.SAMPLES_AUTH_IMPERSONATION_FRONTEND_URI;

    if (frontendUri == null) {
      throw new Error("SAMPLES_AUTH_IMPERSONATION_FRONTEND_URI must be set (see mise.toml)");
    }

    const auth = new AuthGateway(this, "Auth", {
      stage: "dev",
      frontendUri,
      allowSignUp: true,
      authorizerCache: "disabled",
    });

    const api = new Nodejs24Function(this, "Api", {
      entry: `${__dirname}/api/handler.ts`,
      handler: "handler.handler",
    });
    auth.addAuthorizedEndpoint({ lambda: api, path: "/api/{proxy+}" });
    auth.grantSdkAccess(api);

    const site = new StaticWebsite(this, "Site", {
      source: Source.asset(resolve(__dirname, "./site")),
      mode: "singlePageApplication",
      domain: undefined,
      refererId: "samples-auth-impersonation",
      contentSecurityPolicy: {
        connectSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        requireTrustedTypesFor: [],
      },
      deploymentLambdaMemoryLimit: 3008,
    });

    if (auth.api.url == null) throw Error(`Unexpected error - missing api url`);
    site.distribution.addBehavior("/api/*", new HttpOrigin(Fn.parseDomainName(auth.api.url)), {
      allowedMethods: AllowedMethods.ALLOW_ALL,
      cachePolicy: CachePolicy.CACHING_DISABLED,
      originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
      functionAssociations: [
        {
          function: auth.ensureCookieFunction,
          eventType: FunctionEventType.VIEWER_REQUEST,
        },
      ],
    });

    const authBehaviour = auth.createAuthBehavior(site.distribution);
    site.distribution.addBehavior("/auth/*", authBehaviour.origin, authBehaviour);

    const consumer = new Nodejs24Function(this, "Consumer", {
      entry: `${__dirname}/consumer.ts`,
      handler: "consumer.handler",
      memorySize: 256,
      timeout: Duration.seconds(10),
    });

    new Rule(this, "AuthEventsRule", {
      eventPattern: {
        source: ["beesolve.auth.api"],
        detailType: ["ImpersonationStarted", "ImpersonationEnded"],
      },
      targets: [new LambdaFunction(consumer)],
    });
  }
}
