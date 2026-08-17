# ADR-001: Why This Package Exists

## Status

Accepted

## Context

Event-based architectures are becoming the default for building reliable services. SQS is the backbone of async processing on AWS — it decouples producers from consumers, provides at-least-once delivery, and handles backpressure naturally. Most developers building on AWS will reach for SQS sooner or later.

But using SQS properly in a Node.js Lambda is not straightforward:

1. **Batch processing boilerplate.** Lambda receives a batch of SQS messages. You need to iterate, deserialize, process each one individually, and report partial failures correctly (via `batchItemFailures`). Getting this wrong means either losing messages or reprocessing entire batches.

2. **Type safety gap.** The message you send to SQS and the message the consumer receives are the same shape — but there's nothing in the AWS SDK enforcing this. A typo in the message body structure is a runtime error, not a compile-time error.

3. **DLQ configuration.** Every production queue needs a dead-letter queue. Setting up the pair (main queue + DLQ + redrive policy + alarms) is repetitive CDK boilerplate.

4. **Enqueue/dequeue disconnect.** The code that sends a message and the code that handles it live in different files, often different packages. There's no compile-time guarantee they agree on the message format.

## Decision

Build a package that provides:

- **Type-safe task queues** — define handler functions with typed arguments, get a matching typed client for enqueuing. The producer and consumer share the same type definitions at compile time.
- **Automatic partial batch failure reporting** — each message is processed individually; failures are reported per-message via `batchItemFailures` without any manual bookkeeping.
- **CDK construct** — provisions the queue + DLQ + Lambda consumer with sane defaults in a single construct.
- **Function-call-like DX** — sending a message to the queue feels like calling a function. The abstraction intentionally blurs the line between "invoke this function" and "enqueue this message for eventual processing."

## Rationale

### 1. The abstraction improves DX without hiding too much

The core insight is that for most use cases, `await tasks.processReport({ reportId })` is what the developer wants to write — not `await sqs.send(new SendMessageCommand({ QueueUrl, MessageBody: JSON.stringify(...) }))`. The abstraction maps directly to intent.

### 2. Type safety catches integration bugs at compile time

When the handler signature changes, the enqueue client breaks at compile time. This eliminates an entire class of bugs that normally only surface in production when a consumer receives an unexpected payload.

### 3. Rich serialization beyond JSON.stringify

SQS message bodies are strings, so arguments must be serialized. Rather than using `JSON.stringify` (which silently drops `undefined`, corrupts `Date` to strings, cannot handle `BigInt`, `Infinity`, `NaN`, `Buffer`, or `FormData`), the package uses `encodeToStringifiable`/`decodeFromStringifiable` from `@beesolve/helpers`. This preserves types that JavaScript developers commonly pass as function arguments.

Limitations: cannot serialize functions, symbols, circular references, class instances (non-plain objects), or objects nested deeper than 30 levels. These throw at enqueue time rather than silently corrupting data.

### 4. Partial batch failures are critical and easy to get wrong

If one message in a batch of 10 fails, only that message should return to the queue. The default Lambda behavior (without `batchItemFailures`) retries the entire batch — causing duplicate processing of 9 already-successful messages. This package handles it correctly by default.

### 5. The abstraction has a cost — and we're explicit about it

Blurring the line between "function call" and "queue message" is intentional for DX but potentially misleading. A developer who doesn't understand the async/eventual nature of the underlying mechanism might have incorrect expectations about ordering, timing, or error propagation. We mitigate this by:

- Requiring explicit `Promise<void>` return type on handlers (you can't "return a value" to the caller)
- Documenting that delivery is eventual, not synchronous
- Making the SQS/DLQ infrastructure visible in the CDK construct (not hidden behind magic)

## Consequences

- Developers get a significantly simpler API for the most common SQS patterns (task queues with typed messages).
- Partial batch failure handling is correct by default — no manual `batchItemFailures` management.
- FIFO queue support is included for ordered processing use cases.
- The abstraction may be problematic for developers unfamiliar with event-based systems — the "function call" ergonomics might mask the eventual-consistency semantics.
- Not suitable for every SQS use case — raw message processing, fan-out patterns, or cross-account queues may still need direct SDK usage.

## Features Included Out of the Box

- Standard and FIFO queue support
- Automatic DLQ with configurable max receive count
- Partial batch failure reporting (`batchItemFailures`)
- Type-safe enqueue client generated from handler definitions
- KMS encryption support
- Local development mode (direct invocation without SQS for faster iteration)
- Multiple queue configurations from a single construct
- CDK construct provisioning queue + DLQ + consumer Lambda

## Alternatives Considered

### Use AWS SDK directly in each project

Rejected. Repetitive boilerplate, no type safety between producer and consumer, partial batch failure handling reimplemented per project.

### Use a message queue abstraction library (e.g. Bull, BullMQ)

Rejected. These are Redis-based and designed for long-running Node.js processes, not serverless Lambda. They don't integrate with SQS or CDK.

### Use EventBridge instead of SQS

Not a replacement — EventBridge is for event routing (fan-out, filtering), SQS is for task queues (point-to-point, backpressure, retries). They serve different purposes and are often used together.
