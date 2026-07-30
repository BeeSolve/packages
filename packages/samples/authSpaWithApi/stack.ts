import { resolve } from "node:path";

import { AuthGateway } from "@beesolve/auth-service/cdk";
import { Nodejs24Function, StaticWebsite } from "@beesolve/cdk-constructs";
import type { App, StackProps } from "aws-cdk-lib";
import { Fn, Stack } from "aws-cdk-lib";
import {
  AllowedMethods,
  CachePolicy,
  FunctionEventType,
  OriginRequestPolicy,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { Source } from "aws-cdk-lib/aws-s3-deployment";

/**
 * Demonstrates a React SPA with a tRPC API Lambda — no SSR.
 *
 * Key concepts:
 * - React 19 SPA built with Vite, deployed via StaticWebsite construct (S3 + CloudFront)
 * - tRPC server on a separate Lambda behind `/api/*`
 * - Session authorizer protects the API endpoint
 * - `ensureCookieFunction` on `/api/*` so unauthenticated API calls reach the authorizer
 * - `getAwsLambdaAuthorizerContext` extracts userId from the authorizer payload
 * - `/auth/*` routes handled by the auth service
 * - No email delivery — uses dev code (000000)
 */
export class SpaWithApiStack extends Stack {
  constructor(scope: App, id: string, props: StackProps) {
    super(scope, id, props);

    const frontendUri = process.env.SAMPLES_AUTH_SPA_WITH_API_FRONTEND_URI;

    if (frontendUri == null) {
      throw new Error("SAMPLES_AUTH_SPA_WITH_API_FRONTEND_URI must be set (see mise.toml)");
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

    const site = new StaticWebsite(this, "Site", {
      source: Source.asset(resolve(__dirname, "./site/dist")),
      mode: "singlePageApplication",
      domain: undefined,
      refererId: "samples-auth-spa-with-api",
      contentSecurityPolicy: {
        connectSrc: ["'self'"],
        requireTrustedTypesFor: [],
      },
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
  }
}
