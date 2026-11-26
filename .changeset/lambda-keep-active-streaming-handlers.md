---
"@beesolve/lambda-keep-active": minor
---

Add `keptActiveStreaming` for streaming handlers with the signature `(event, responseStream, context)`, such as the result of `asResponseStreamHandler`. It copies the properties of the wrapped function, including the streaming marker symbol, so the Lambda runtime still streams. `keptActive` is unchanged. Documented that `keptActiveFetch` does not apply to the Bun runtime v4.
