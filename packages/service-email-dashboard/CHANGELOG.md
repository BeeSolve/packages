# @beesolve/email-service-dashboard

## 0.1.0

### Minor Changes

- Add `@beesolve/email-service-dashboard` — a prebuilt kit-on-lambda SvelteKit dashboard for viewing `@beesolve/email-service` delivery status. It ships a single `./cdk` construct (`EmailServiceDashboard`) that provisions the SSR Lambda behind CloudFront, wires `@beesolve/auth-service` email-code auth, provisions its own OTP `Emails`, and runs an event-ingest Lambda that projects the email delivery lifecycle (from EventBridge) into its own DynamoDB table — giving the UI durable, queryable message, status, and aggregate-stats data.
