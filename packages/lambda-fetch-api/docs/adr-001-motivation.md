# ADR-001: Why This Package Exists

## Status

Accepted

## Context

AWS Lambda handlers receive cloud-specific event objects (API Gateway v1 REST events, v2 HTTP events, ALB events) with different shapes, different header formats, and different response structures. Writing directly against these:

1. **Couples application code to AWS.** Your handler logic is untestable without mocking Lambda event shapes. You can't run it locally with a standard HTTP server.

2. **Fragments the ecosystem.** Each framework (Express, Fastify, Hono, tRPC) has its own Lambda adapter. Switching frameworks or supporting multiple API Gateway versions means different adapter packages.

3. **Hides a standard that already exists.** The Fetch API (`Request`/`Response`) is a Web Standard supported by every modern runtime (Node.js, Bun, Deno, Cloudflare Workers, browsers). It's the universal interface for HTTP handling.

## Decision

Build an adapter that:

- Converts API Gateway v1 and v2 events into standard `Request` objects
- Converts standard `Response` objects back into Lambda proxy results
- Uses `AsyncLocalStorage` to make the original AWS event and context available anywhere without threading arguments
- Supports response streaming, authorizer patterns, and Standard Schema validation of authorizer payloads

The handler signature becomes `(request: Request) => Promise<Response>` — the same signature used by Bun, Deno, Cloudflare Workers, and the Node.js `fetch` event.

## Rationale

### 1. Write once, run anywhere

A handler written against `Request`/`Response` works on Lambda, on a local Bun/Node server for development, in integration tests with `fetch()`, or on any other runtime that supports the Fetch API. No mocking, no adapters, no environment-specific code paths.

### 2. Framework-agnostic

SvelteKit, tRPC, Hono, or plain handlers — anything that produces a `Response` from a `Request` works. The adapter doesn't care what generates the response. This means framework migrations don't require changing the Lambda integration layer.

### 3. AWS context without argument threading

Via `AsyncLocalStorage`, any code in the call stack can access the original AWS event, context, request ID, or remaining execution time without having the `request` object passed to it. This is critical for deep library code (logging, tracing, auth extraction) that shouldn't depend on the HTTP layer.

### 4. Standard over custom

The Fetch API is maintained by WHATWG with implementations in every major runtime. Building on a standard means the knowledge transfers, tooling works, and the interface won't be deprecated by a framework author's decision.

## Consequences

- Lambda handlers are testable with any HTTP testing tool — no Lambda-specific test utilities needed.
- Local development uses the same handler code with a standard server (Bun.serve, Node.js http server).
- The package must handle edge cases in API Gateway event formats (binary encoding, multi-value headers, cookies) — this complexity is centralized rather than spread across consumers.
- Developers must understand that `getAwsEvent()` / `getAwsContext()` only work within a handler invocation (enforced by AsyncLocalStorage).
- Response streaming support adds complexity but enables large responses without Lambda payload limits.

## Alternatives Considered

### Use a framework with a built-in Lambda adapter (Hono, Fastify)

Rejected as a general solution. Ties you to a specific framework. The adapter should be below the framework layer so you can use any framework (or none).

### Write against raw Lambda events

Rejected. Couples application logic to AWS, makes local development painful, fragments code when supporting multiple API Gateway versions.

### Use AWS Lambda Web Adapter (LWA)

LWA runs a real HTTP server inside Lambda and proxies events to it. This adds startup latency, memory overhead, and an unnecessary network hop inside the execution environment. Direct event-to-Request conversion is lighter and faster.
