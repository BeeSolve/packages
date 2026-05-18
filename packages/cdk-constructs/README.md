# @beesolve/cdk-constructs

Various CDK constructs built at BeeSolve.

## Installation

```bash
npm i @beesolve/cdk-constructs
```

---

## Nodejs24Function

Deploys a Node.js 24 Lambda with opinionated defaults: ARM64, esbuild ESM bundling, JSON logging, and a managed log group with 2-week retention.

```typescript
// Build from TypeScript source
new Nodejs24Function(this, "Api", {
  entry: "src/handlers/api.ts",
});

// Pre-built ZIP or directory — handler is required
new Nodejs24Function(this, "Api", {
  entry: "dist/api.zip",
  handler: "api.handler",
});
```

### tagFunctionsWithRevision

Tags every `Function` in the stack with the current git commit hash. Useful alongside external source maps for tracing Lambda errors back to the exact revision.

```typescript
tagFunctionsWithRevision(stack, {});
```

---

## SqsWithDlq

SQS queue + dead-letter queue pair. Defaults: SQS-managed encryption, SSL enforced, 14-day retention, 5 max receive count.

```typescript
const { queue, dlq } = new SqsWithDlq(this, "Jobs");

// FIFO
const fifo = new SqsWithDlq(this, "OrderedJobs", {
  queue: { fifo: true, contentBasedDeduplication: true },
});
```

### asLambdaInput

Wires the queue as an SQS event source on a Lambda function. Sets the visibility timeout to 6× the Lambda timeout (capped at 12 hours). Emits a CDK warning if the cap is applied.

```typescript
SqsWithDlq.asLambdaInput({
  lambda: myFunction,
  batching: { batchSize: 10, maxBatchingWindow: Duration.seconds(30) },
});

// Pause consumption during maintenance
SqsWithDlq.asLambdaInput({ lambda: myFunction, disabled: true });
```

---

## StaticWebsite

CloudFront + S3 static website with security headers (CSP, HSTS, X-Frame-Options), optional custom domain with SSL, optional basic auth, and SPA/MPA mode.

`refererId` is a shared secret placed in the CloudFront origin request header and the S3 bucket policy — choose a long random string.

```typescript
new StaticWebsite(this, "Website", {
  mode: "singlePageApplication",
  source: Source.asset("dist"),
  refererId: "a3f8...long-random-secret...c9d2",
  contentSecurityPolicy: {
    connectSrc: ["https://api.example.com"],
    scriptSrc: ["'self'", "https://cdn.example.com"],
  },
  domain: {
    name: "example.com",
    certificate: "arn:aws:acm:us-east-1:...",
    redirect: "enforceNonWww",
  },
  basicHttpAuthentication: {
    username: "admin",
    password: "secret",
  },
});
```

---

## CloudFrontAccessLoggingSettings

Creates an S3 log bucket for CloudFront access logs, with optional AWS Glue + Athena for SQL queries.

```typescript
const logging = new CloudFrontAccessLoggingSettings(this, "Logging", {
  logFilePrefix: "cf-logs/",
  athena: {
    account: this.account,
    glueDbName: "cf_logs_db",
    columns: ["date", "c-ip", "sc-status", "cs-uri-stem"],
  },
});

new StaticWebsite(this, "Website", {
  // ...
  logging: logging.cloudFrontLoggingSettings,
});
```

---

## esmBuild / esmBuildSync

Low-level esbuild wrapper producing ESM output targeting Node.js 24, with CommonJS polyfills, minification, tree-shaking, and external source maps.

```typescript
// Async
await esmBuild({ entryPoints: ["src/index.ts"], outDir: "dist" });

// Sync (for use during CDK synth)
esmBuildSync({ entryPoints: ["src/index.ts"], outDir: "dist" });
```
