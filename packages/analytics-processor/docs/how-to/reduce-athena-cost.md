# How to: Reduce Athena cost by delivering only the fields the processor needs

The hourly processor reads only **10 of the 33** CloudFront standard-logging fields. Athena
bills on bytes scanned, so delivering the full field set to Parquet wastes storage and
scan cost. The processor exports exactly the fields it needs as `requiredRecordFields` so
you can pass them straight to `CloudFrontAccessLoggingSettings`.

The fields: `timestamp`, `sc_status`, `sc_bytes`, `cs_bytes`, `time_taken`,
`x_edge_result_type`, `x_edge_detailed_result_type`, `cs_uri_stem`, `c_ip`,
`cs_user_agent`.

## Usage

```ts
import { requiredRecordFields } from "@beesolve/analytics-processor";
import { CloudFrontAccessLoggingSettings } from "@beesolve/cdk-constructs";

const logging = new CloudFrontAccessLoggingSettings(this, "Logging", {
  athena: {
    account,
    recordFields: requiredRecordFields,
  },
});
```

With `recordFields` set, the Parquet Glue table has exactly those 11 columns and the v2
delivery writes only those fields. Omit `recordFields` to capture all fields (useful if you
want ad-hoc Athena queries beyond what the processor computes).

`requiredRecordFields` is a plain string array of normalized column names; it matches the
`CloudFrontAccessLogField` names the construct accepts and does not pull in a runtime
dependency on `@beesolve/cdk-constructs`.
