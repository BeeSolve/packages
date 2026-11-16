# ADR-001: Why This Package Exists

## Status

Accepted

## Context

Lambda functions and SQS queues with dead-letter queues need alarms that notify a
person by email. Doing this in CDK takes several resources each time: an SNS topic,
an email subscription, a CloudWatch alarm with a threshold, comparison operator and
missing-data policy, and the alarm actions wired to the topic.

The same two cases come up repeatedly:

- A Lambda function reporting at least one error in an evaluation period
- An SQS queue and DLQ pair where any visible DLQ message is a problem, and where
  the queue receiving no messages or having no consumers for a period can also be
  a problem

Workspace packages (`@beesolve/sqs-handler`, `@beesolve/auth-service`, and the
samples) declare `@beesolve/cdk-email-alarms` as a dependency.

## Decision

Provide a small standalone CDK construct, `EmailAlarms`, created once with an
`emailAddress`. It owns a single SNS topic with one email subscription and exposes
two methods: `reportLambdaErrors(handler)` and `reportSqsErrors({ queue, dlq,
noMessagesPeriod?, noConsumersPeriod? })`.

## Rationale

### 1. One topic, one subscription confirmation

All alarms of an `EmailAlarms` instance share one topic. The recipient confirms
one subscription, fewer resources are created, and the alarm name and description
still show what fired.

### 2. Fixed, reviewed alarm settings

Thresholds, comparison operator and `treatMissingData` are chosen once in the
construct. Callers pass the resource to watch and do not repeat the alarm
configuration.

### 3. Separate from `@beesolve/cdk-constructs`

The package only depends on `aws-cdk-lib` and `constructs` as peer dependencies and
on no other workspace package. Packages that only need alarms do not pull in the
esbuild-based constructs of `@beesolve/cdk-constructs`.

## Consequences

- Alarm setup for Lambda and SQS is two method calls on one construct.
- Notifications go to one email address through SNS. Other channels (Slack,
  PagerDuty) and other metrics are out of scope.
- Alarm resources are created under the monitored function or queue, while the
  topic lives under the `EmailAlarms` construct.

## Alternatives Considered

### Define alarms inline in each stack

Rejected. Each stack would repeat the topic, subscription and alarm settings, and
the settings could differ between stacks.

### Add the alarms to `@beesolve/cdk-constructs`

Rejected. That package carries an esbuild dependency and bundling constructs.
Alarms are an independent concern that other packages can adopt on their own.

### One SNS topic per alarm

Rejected. It would multiply subscriptions that each need confirmation.
