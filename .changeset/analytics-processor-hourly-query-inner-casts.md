---
"@beesolve/analytics-processor": patch
---

Restructure the hourly Athena query so the device classification and the numeric
casts happen in an inner subquery, and `GROUP BY GROUPING SETS` references plain
column references in the outer query. Athena/Trino rejects a GROUPING SETS element
that is a select alias or a computed expression (`COLUMN_NOT_FOUND` for the
`device` alias, `INVALID_COLUMN_REFERENCE` for the inlined CASE expression). The v2
column map now casts the numeric columns (`sc_status`, `sc_bytes`, `cs_bytes`,
`time_taken`) because CloudFront v2 Parquet stores every field as BINARY/string, so
the previous bare references mis-behaved in `sum`/`BETWEEN`/`approx_percentile`.
Output column names are unchanged, so the result parser is unaffected.
