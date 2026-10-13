---
"@beesolve/cdk-constructs": patch
---

Declare every CloudFront v2 Glue table column as `string`. CloudFront
standard-logging-v2 writes Parquet where every field is stored as BINARY/string,
so the previously declared numeric types (`sc_status` int; `sc_bytes`, `cs_bytes`,
`sc_content_len`, `sc_range_start`, `sc_range_end` bigint; `time_taken`,
`time_to_first_byte` double) were incompatible with the real data and caused
`HIVE_BAD_DATA: Malformed Parquet file ... type BINARY ... is incompatible with
type integer` at query time. All columns are now `string`; downstream consumers
cast as needed.
