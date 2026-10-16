---
"@beesolve/lambda-fetch-api": patch
---

Return `400 Bad Request` instead of crashing the handler when the incoming
request has a malformed URL. Internet scanners probe API Gateway with paths like
`//`, `//?phpinfo=1`, and `//:2375/containers/json`, which `new URL()` rejects
with `ERR_INVALID_URL`; previously this threw out of `awsRequest` and surfaced as
a Lambda invocation error (and a `Errors` alarm). `awsEventURL` now wraps URL
construction and throws a typed `MalformedRequestError` for `ERR_INVALID_URL`,
rethrowing anything else untouched so genuine failures still surface as 500s. The
`asHttp*Handler` factories catch `MalformedRequestError` and return a 400 without
invoking the inner fetch. `MalformedRequestError` is exported.
