---
"@beesolve/lambda-fetch-api": minor
---

Add typed event accessors, valibot validation, and local testing helpers.

- `toAwsV1Event(request)` and `toAwsV2Event(request)` — typed variants of `toAwsEvent` for when the caller knows which API Gateway version they're working with. `toAwsEvent` is kept as the auto-detecting union form.
- `withAwsEvent(request, event)` and `withAwsContext(request, context)` — helpers for building test requests without going through a full `awsRequest()` call.
- `InvalidAwsEventHeaderError` and `InvalidAwsContextHeaderError` — thrown when the header is present but fails schema validation.
- The `aws-event` and `aws-context` headers are now validated with valibot schemas on decode.
