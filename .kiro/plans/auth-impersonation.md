# Implementation Plan — Impersonation Feature

> **Last updated:** 2026-07-24 — aligned with `@beesolve/auth-service@0.11.0`

## Problem Statement

Operators (admins, support staff) need the ability to act as another user for debugging and support purposes. The current auth-service has no mechanism to create a session on behalf of another user while preserving an audit trail of who initiated it.

This plan adds impersonation support: an SDK command to start an impersonation session, a public auth endpoint to end it, new EventBridge events for audit, and a discriminated session context so downstream handlers can detect impersonation.

## Design Decisions

1. **`userId` stays as the effective user** — handlers that don't care about impersonation continue reading `session.userId` and work unchanged. The impersonation metadata is additive.

2. **Discriminated union in session context** — the valid session identity is `{ userId, impersonating: false }` or `{ userId, impersonating: true, impersonatedBy }`. Handlers pattern-match on `impersonating` to guard sensitive actions or show UI indicators. This applies to both the authorizer-based path (`getSessionContext()` / `createSessionHandle()`) and the in-process path (`createInProcessSessionHandle()` / `withSession()`).

3. **Flat `impersonatedBy` field in DynamoDB** — a single optional string on the session row. When absent → normal session. When present → the value is the account ID of whoever initiated the impersonation. The existing `userId` GSI still works (queries by effective user).

4. **SDK command to start, auth endpoint to end** — starting impersonation is a privileged server-to-server operation (SDK). Ending it is a browser action that needs to set a new cookie, so it's a public auth endpoint like `signOut`.

5. **Short-lived sessions** — impersonation sessions have a configurable max age (default 1 hour, max 4 hours) to limit exposure.

6. **Authorization is the caller's responsibility** — the auth-service is an authentication layer. It doesn't know who is an "admin." The calling service must verify the operator has permission to impersonate before invoking the SDK command.

7. **Breaking change to session context** — `ValidSession` changes from `{ userId, sessionId, expiresAt }` to a discriminated union. This will be a minor version bump (0.12.0). All consumers must update their session reading code.

## DynamoDB Schema Change

No table or index changes. A single optional attribute is added to session items:

| Attribute        | Type     | Description                                                                                     |
| ---------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `impersonatedBy` | `string` | Account ID of the user who initiated the impersonation. Only present on impersonation sessions. |

Existing sessions without this field are naturally the `impersonating: false` case — zero migration needed.

## Session Context Shape

The `validSession` object in the session context changes from a flat object to a discriminated union. This applies to both paths:

- **Authorizer-based** (`createSessionHandle()` / `getSessionContext()`): the authorizer Lambda serializes the session into the authorizer context JSON
- **In-process** (`createInProcessSessionHandle()` / `withSession()`): the session is resolved directly from DynamoDB

```ts
// Before (0.11.x)
type ValidSession = {
  userId: string;
  sessionId: string;
  expiresAt: string;
};

// After (0.12.0)
type ValidSession =
  | { userId: string; sessionId: string; expiresAt: string; impersonating: false }
  | {
      userId: string;
      sessionId: string;
      expiresAt: string;
      impersonating: true;
      impersonatedBy: string;
    };
```

Both the authorizer Lambda (`src/authorize.ts`) and the in-process authorizer (`sessionAuthorizer.ts`) build this by checking the session row:

```ts
// In authorize logic, after fetching the session:
const validSession =
  session.impersonatedBy != null
    ? {
        userId: session.userId,
        sessionId,
        expiresAt,
        impersonating: true as const,
        impersonatedBy: session.impersonatedBy,
      }
    : { userId: session.userId, sessionId, expiresAt, impersonating: false as const };
```

## SDK Command — `impersonate`

A new command added to the SDK handler. Only callable by Lambdas with `grantSdkAccess`.

### Request

```ts
type ImpersonateCommand = {
  type: "impersonate";
  request: {
    targetUserId: string; // the user to impersonate
    currentUserId: string; // who is initiating (the operator)
    maxAge?: number; // session lifetime in seconds (default 3600, max 14400)
  };
  response: {
    sid: string; // session cookie value to set on the response
    maxAge: number; // cookie max-age in seconds
  };
};
```

### Implementation

```ts
if (type === "impersonate") {
  const parsed = v.parse(impersonateSchema, request);

  const maxAge = Math.min(parsed.maxAge ?? 3600, 14400); // cap at 4 hours

  const session = await sessions.createOne({
    userId: parsed.targetUserId,
    maxAge,
    data: {},
    impersonatedBy: parsed.currentUserId,
  });

  await events.putEvents({
    type: "ImpersonationStarted",
    detail: {
      currentUserId: parsed.currentUserId,
      targetUserId: parsed.targetUserId,
      startedAt: new Date().toISOString(),
    },
  });

  return { sid: session.id, maxAge };
}
```

### SDK Client Usage

```ts
import { AuthClient } from "@beesolve/auth-service/sdk";

const auth = new AuthClient();

// Start impersonation (in your admin panel backend Lambda)
const { sid, maxAge } = await auth.invoke({
  type: "impersonate",
  request: {
    targetUserId: "user-to-impersonate-id",
    currentUserId: "operator-account-id", // from the operator's own session
    maxAge: 3600, // optional, 1 hour
  },
});

// Set the cookie on the response to the operator's browser
const response = new Response(null, {
  status: 301,
  headers: {
    Location: "/dashboard",
  },
});
addSetCookies({
  headers: response.headers,
  cookies: [{ sid, maxAge }],
});
```

## Auth Endpoint — `POST /auth/endImpersonation`

A public endpoint accessible from the browser. Creates a new session for the original operator and clears the impersonation session.

### Request

```json
{
  "redirectTo": "/admin/dashboard"
}
```

### Behavior

1. Read the current session from the `__Host-SID` cookie (via the authorizer context).
2. Verify the session has `impersonating: true`. If not → 400 Bad Request.
3. Create a new normal session for `impersonatedBy` (the operator).
4. Delete the impersonation session.
5. Emit `ImpersonationEnded` event.
6. Respond with 301 redirect + `Set-Cookie` (clear old, set new).

### Implementation

```ts
export async function endImpersonation({
  sessions,
  events,
  requestBody,
  session, // ValidSession from session context
  headers,
}: Dependencies): Promise<Response> {
  if (!session.impersonating) {
    throw new BadRequestError("Not in an impersonation session.");
  }

  const { redirectTo } = parseBody({ body: await requestBody(), schema });

  // Create a new session for the original operator
  const newSession = await sessions.createOne({
    userId: session.impersonatedBy,
    data: Sessions.dataFromCloudFrontHeaders(Object.fromEntries(headers.entries())),
  });

  // Delete the impersonation session
  await sessions.delete(session.sessionId);

  await events.putEvents({
    type: "ImpersonationEnded",
    detail: {
      currentUserId: session.impersonatedBy,
      targetUserId: session.userId,
      endedAt: new Date().toISOString(),
    },
  });

  const cookies = [
    { sid: session.sessionId, maxAge: -1 }, // clear impersonation cookie
    { sid: newSession.id, maxAge: newSession.maxAge }, // set operator's cookie
  ];

  // Content negotiation: JSON response for SPA clients, redirect for traditional apps
  const acceptsJson = headers.get("accept")?.includes("application/json");
  if (acceptsJson) {
    return new Response(JSON.stringify({ redirectTo: redirectTo ?? "/" }), {
      status: 200,
      headers: addSetCookies({
        headers: new Headers({
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        }),
        cookies,
      }),
    });
  }

  return new Response(null, {
    status: 301,
    headers: addSetCookies({
      headers: new Headers({
        "Cache-Control": "no-store",
        Location: redirectTo ?? "/",
      }),
      cookies,
    }),
  });
}
```

## EventBridge Events

Three new events added to the auth event bus:

| `detail-type`          | Fired when                                       | Key fields                                   |
| ---------------------- | ------------------------------------------------ | -------------------------------------------- |
| `ImpersonationStarted` | SDK `impersonate` command succeeds               | `currentUserId`, `targetUserId`, `startedAt` |
| `ImpersonationEnded`   | `/auth/endImpersonation` completes               | `currentUserId`, `targetUserId`, `endedAt`   |
| `ImpersonationExpired` | Authorizer detects expired impersonation session | `currentUserId`, `targetUserId`, `expiredAt` |

### Event Schemas

```ts
interface ImpersonationStarted {
  readonly type: "ImpersonationStarted";
  readonly detail: {
    readonly currentUserId: string; // who initiated
    readonly targetUserId: string; // who is being impersonated
    readonly startedAt: string; // ISO timestamp
  };
}

interface ImpersonationEnded {
  readonly type: "ImpersonationEnded";
  readonly detail: {
    readonly currentUserId: string;
    readonly targetUserId: string;
    readonly endedAt: string;
  };
}

interface ImpersonationExpired {
  readonly type: "ImpersonationExpired";
  readonly detail: {
    readonly currentUserId: string;
    readonly targetUserId: string;
    readonly expiredAt: string;
  };
}
```

### `ImpersonationExpired` via DynamoDB Streams

When `impersonationExpiredEvents` is enabled in CDK, a stream Lambda processes session deletions (both TTL-based and explicit):

```ts
// Stream handler (simplified)
export async function handler(event: DynamoDBStreamEvent) {
  for (const record of event.Records) {
    if (record.eventName !== "REMOVE") continue;

    const oldImage = record.dynamodb?.OldImage;
    if (oldImage == null) continue;

    const impersonatedBy = oldImage.impersonatedBy?.S;
    if (impersonatedBy == null) continue; // not an impersonation session

    const userId = oldImage.userId?.S;
    const expiresAt = oldImage.expiresAt?.N;

    await events.putEvents({
      type: "ImpersonationExpired",
      detail: {
        currentUserId: impersonatedBy,
        targetUserId: userId,
        expiredAt: new Date(Number(expiresAt) * 1000).toISOString(),
      },
    });
  }
}
```

This approach keeps the authorizer lightweight (no EventBridge dependency) and only adds cost when the feature is explicitly opted into.

## Flows

### Start Impersonation

```mermaid
sequenceDiagram
    participant Admin as Operator Browser
    participant AdminAPI as Admin Panel Lambda
    participant SDK as Auth SDK Handler
    participant DDB as DynamoDB Sessions
    participant EB as EventBridge

    Admin->>AdminAPI: POST /admin/impersonate {targetUserId}
    Note over AdminAPI: Verify operator has permission
    AdminAPI->>SDK: invoke({type: "impersonate", request: {targetUserId, currentUserId, maxAge}})
    SDK->>DDB: PutItem (userId=targetUserId, impersonatedBy=currentUserId, TTL=maxAge)
    SDK->>EB: ImpersonationStarted {currentUserId, targetUserId, startedAt}
    SDK-->>AdminAPI: {sid, maxAge}
    AdminAPI-->>Admin: 301 + Set-Cookie: __Host-SID=sid (clear old + set new)
    Note over Admin: Browser now has impersonation session cookie
```

### Impersonated Request

```mermaid
sequenceDiagram
    participant Browser as Operator Browser (impersonating)
    participant CF as CloudFront
    participant GW as API Gateway
    participant Auth as Authorizer Lambda
    participant DDB as DynamoDB Sessions
    participant Handler as Your Lambda

    Browser->>CF: GET /api/data (Cookie: __Host-SID=impersonation-sid)
    CF->>GW: forward
    GW->>Auth: invoke (Cookie header)
    Auth->>DDB: GetItem(id=impersonation-sid)
    DDB-->>Auth: {userId: targetUser, impersonatedBy: operatorId, ...}
    Auth-->>GW: Allow + context {userId: targetUser, impersonating: true, impersonatedBy: operatorId}
    GW->>Handler: invoke with authorizer context
    Note over Handler: session.userId = target user<br/>session.impersonating = true<br/>session.impersonatedBy = operator
    Handler-->>GW: 200
    GW-->>CF: 200
    CF-->>Browser: 200
```

### End Impersonation

```mermaid
sequenceDiagram
    participant Browser as Operator Browser (impersonating)
    participant CF as CloudFront
    participant API as Auth API Lambda
    participant DDB as DynamoDB Sessions
    participant EB as EventBridge

    Browser->>CF: POST /auth/endImpersonation {redirectTo: "/admin"}
    CF->>API: OAC-signed request
    Note over API: Read session from authorizer context
    API->>API: Verify session.impersonating === true
    API->>DDB: PutItem (new session for impersonatedBy user)
    API->>DDB: DeleteItem (impersonation session)
    API->>EB: ImpersonationEnded {currentUserId, targetUserId, endedAt}
    API-->>CF: 301 + Set-Cookie (clear old, set operator session)
    CF-->>Browser: 301 → /admin
    Note over Browser: Browser now has operator's own session
```

### Impersonation Session Expires

```mermaid
sequenceDiagram
    participant Browser as Operator Browser
    participant Auth as Authorizer / In-process Session Handler
    participant DDB as DynamoDB Sessions

    Browser->>Auth: request with expired impersonation cookie
    Auth->>DDB: GetItem(id=sid)
    DDB-->>Auth: {userId: target, impersonatedBy: operator, expiresAt: past}
    Auth-->>Browser: context {type: "expired", ...}
    Note over Browser: Handler returns 401 / redirect to login
    Note over DDB: TTL eventually deletes the item
    Note over DDB: If impersonationExpiredEvents enabled:<br/>DDB Stream → Lambda → EventBridge ImpersonationExpired
```

## Handler Usage Examples

### Detecting impersonation in a handler (in-process pattern)

```ts
import { SessionAuthorizer, withSession } from "@beesolve/auth-service/sessionAuthorizer";

const authorizer = new SessionAuthorizer();

export const fetch = withSession(authorizer, async (request, session) => {
  // session.userId is always the effective user (the target)
  const data = await loadUserData(session.userId);

  if (session.impersonating) {
    // Log for audit, show banner, or restrict actions
    console.log(`Impersonated by ${session.impersonatedBy}`);
  }

  return new Response(JSON.stringify(data));
});
```

### Detecting impersonation in a SvelteKit hook

```ts
// hooks.server.ts
const authGuard: Handle = async ({ event, resolve }) => {
  const session = event.locals.session;

  if (session.type === "valid" && session.validSession.impersonating) {
    // Add impersonation indicator to page data
    event.locals.impersonatedBy = session.validSession.impersonatedBy;
  }

  return resolve(event);
};
```

### Blocking sensitive actions during impersonation

```ts
export const fetch = withSession(authorizer, async (request, session) => {
  if (session.impersonating) {
    return new Response(
      JSON.stringify({ message: "Cannot perform this action while impersonating." }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  // ... delete account, change email, etc.
});
```

### Admin panel — starting impersonation

```ts
import { AuthClient } from "@beesolve/auth-service/sdk";
import { SessionAuthorizer, withSession } from "@beesolve/auth-service/sessionAuthorizer";
import { addSetCookies } from "@beesolve/auth-service";

const auth = new AuthClient();
const authorizer = new SessionAuthorizer();

export const fetch = withSession(authorizer, async (request, session) => {
  // Your own permission check — auth-service doesn't enforce this
  if (!(await isOperator(session.userId))) {
    return new Response("Forbidden", { status: 403 });
  }

  const { targetUserId } = await request.json();

  const { sid, maxAge } = await auth.invoke({
    type: "impersonate",
    request: {
      targetUserId,
      currentUserId: session.userId,
      maxAge: 3600,
    },
  });

  return new Response(null, {
    status: 301,
    headers: addSetCookies({
      headers: new Headers({
        "Cache-Control": "no-store",
        Location: "/",
      }),
      cookies: [
        { sid: session.sessionId, maxAge: -1 }, // clear operator's session
        { sid, maxAge }, // set impersonation session
      ],
    }),
  });
});
```

### Frontend — end impersonation button

```ts
async function endImpersonation() {
  await fetch("/auth/endImpersonation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirectTo: "/admin/users" }),
  });
  // Browser follows 301 redirect back to admin panel
}
```

## `withSession` and `SessionContext` Type Changes

The `ValidSession` type becomes a discriminated union. The `withSession` wrapper and `getSessionContext()` function continue working — they still reject invalid/expired sessions. But the type signature changes:

```ts
// Before (0.11.x)
export type ValidSession = {
  userId: string;
  sessionId: string;
  expiresAt: string;
};

// After (0.12.0)
export type ValidSession =
  | { userId: string; sessionId: string; expiresAt: string; impersonating: false }
  | {
      userId: string;
      sessionId: string;
      expiresAt: string;
      impersonating: true;
      impersonatedBy: string;
    };
```

This affects:

- `withSession(authorizer, handler)` in `sessionAuthorizer.ts` — the `session` param becomes the wider union
- `getSessionContext()` / `getSessionContextV2()` / `getSessionContextV1()` in `src/sessionContext.ts` — the `validSession` field within `SessionContext` becomes the wider union
- `createSessionHandle()` and `createInProcessSessionHandle()` in `sveltekit.ts` — `event.locals.session.validSession` becomes the wider union

Consumers that only access `session.userId` will continue working because `userId`, `sessionId`, `expiresAt` are present on both variants. The type error only appears if the consumer destructures or spreads the entire session object.

Upgrade paths:

1. **Pattern match** (recommended for handlers that care):

   ```ts
   if (session.impersonating) {
     // session.impersonatedBy available here
   }
   ```

2. **Access common fields directly** — `session.userId` still works without narrowing.

## Session Schema Changes (`session.ts` + `sessionContext.ts` + `sessionAuthorizer.ts`)

In `src/session.ts`, add the optional field to the DynamoDB item schema:

```ts
// Add to session schema:
impersonatedBy: v.optional(v.string()), // ← NEW
```

In `src/sessionContext.ts`, update `validSessionSchema`:

```ts
const validSessionSchema = v.variant("impersonating", [
  v.object({
    userId: v.string(),
    sessionId: v.string(),
    expiresAt: v.string(),
    impersonating: v.literal(false),
  }),
  v.object({
    userId: v.string(),
    sessionId: v.string(),
    expiresAt: v.string(),
    impersonating: v.literal(true),
    impersonatedBy: v.string(),
  }),
]);
```

In `sessionAuthorizer.ts`, update the `ValidSession` type to match:

```ts
export type ValidSession =
  | { userId: string; sessionId: string; expiresAt: string; impersonating: false }
  | {
      userId: string;
      sessionId: string;
      expiresAt: string;
      impersonating: true;
      impersonatedBy: string;
    };
```

In `src/authorize.ts`, build the discriminated context:

```ts
const validSession =
  session.impersonatedBy != null
    ? {
        userId,
        sessionId,
        expiresAt,
        impersonating: true as const,
        impersonatedBy: session.impersonatedBy,
      }
    : { userId, sessionId, expiresAt, impersonating: false as const };
```

`Sessions.createOne` gains an optional `impersonatedBy` param:

```ts
readonly createOne = async (props: {
  readonly userId: string;
  readonly maxAge?: number;
  readonly data: NewSession["data"];
  readonly impersonatedBy?: string; // ← NEW
}) => { /* ... */ };
```

## CDK Changes

Minimal — no new tables or indexes. Changes:

1. **Auth API Lambda** handles the new `/auth/endImpersonation` route (no CDK change, just code in the handler).
2. **Optional CDK prop** for configuring max impersonation duration:

```ts
/**
 * Maximum allowed impersonation session duration.
 * SDK callers can request up to this value. Defaults to 4 hours.
 *
 * @default Duration.hours(4)
 */
readonly maxImpersonationDuration?: Duration;
```

3. **Optional CDK prop** for DynamoDB Streams-based expiration events:

```ts
/**
 * When true, enables DynamoDB Streams on the Sessions table and deploys
 * a Lambda that emits `ImpersonationExpired` events when impersonation
 * sessions are TTL-deleted. Adds cost (Stream read units + Lambda invocations).
 *
 * @default false
 */
readonly impersonationExpiredEvents?: boolean;
```

When enabled, the construct creates:

- A DynamoDB Stream (NEW_AND_OLD_IMAGES) on the Sessions table
- A Lambda that filters for `eventName: "REMOVE"` items where `impersonatedBy` was present
- EventBridge `events:PutEvents` permission for the stream Lambda

## Breaking Changes (0.11.x → 0.12.0)

| Change                                           | Impact                                                                                                                             |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `ValidSession` becomes a discriminated union     | All consumers reading session must handle or acknowledge the union. `session.userId` still accessible without narrowing.           |
| `withSession` handler signature                  | Same — receives `ValidSession` but type is wider now.                                                                              |
| Authorizer context JSON shape                    | Adds `impersonating` and optionally `impersonatedBy` fields. Existing consumers that only destructure known fields are unaffected. |
| `SessionContext.validSession` in SvelteKit hooks | Same union applies — `event.locals.session.validSession` is wider.                                                                 |

## Task Breakdown

### Task 1: Add `impersonatedBy` to session schema and `createOne`

- Add `impersonatedBy: v.optional(v.string())` to session DynamoDB schema
- Add optional `impersonatedBy` param to `Sessions.createOne` and `toNewSession`
- Include in `getOne` projection expression

### Task 2: Update authorize logic to build discriminated context

- In `src/authorize.ts`: read `impersonatedBy` from session row, build `validSession` as discriminated union
- In `sessionAuthorizer.ts`: update `ValidSession` type export to match
- (Optional) Emit `ImpersonationExpired` event on expired impersonation sessions

### Task 3: Update `ValidSession` and `SessionContext` types

- Change `validSessionSchema` in `src/sessionContext.ts` to a `v.variant("impersonating", [...])` discriminated union
- Export updated `ValidSession` type
- Update `sveltekit.ts` dev fallback presets to include `impersonating: false`

### Task 4: Add `impersonate` SDK command

- Add schema, types, and handler logic in `sdkHandler.ts`
- Emit `ImpersonationStarted` event
- Enforce max age cap

### Task 5: Implement `/auth/endImpersonation` endpoint

- New handler `src/handlers/endImpersonation.ts`
- Wire into `api.ts` router
- Emit `ImpersonationEnded` event
- Return redirect with cookie swap (supports content negotiation: JSON `{ redirectTo }` when `Accept: application/json`, otherwise 301)

### Task 6: Add event types

- Add `ImpersonationStarted`, `ImpersonationEnded`, `ImpersonationExpired` to `src/events.ts` and consumer-facing `events.ts`
- Add type guards and schema validation

### Task 7: CDK changes

- Add `maxImpersonationDuration` prop, pass as env var to SDK handler
- Add optional `impersonationExpiredEvents` prop:
  - When `true`: enables DynamoDB Streams on the Sessions table + a Lambda that filters for TTL-deleted items with `impersonatedBy` and emits `ImpersonationExpired` to EventBridge
  - When `false` (default): no stream, no extra Lambda, no expired event

### Task 8: Tests

- Unit test `impersonate` SDK command
- Unit test `endImpersonation` handler
- Unit test `authorize.ts` discriminated context building
- Unit test `withSession` with both variants
- Unit test SvelteKit handle with impersonation session

### Task 9: Update documentation

- Update README session middleware section
- Add impersonation section to README
- Update events table
- Update SDK client examples

## Checklist

- [ ] Task 1: Session schema + `createOne` changes
- [ ] Task 2: Authorizer context discrimination
- [ ] Task 3: `ValidSession` / `SessionContext` type update
- [ ] Task 4: `impersonate` SDK command
- [ ] Task 5: `/auth/endImpersonation` endpoint
- [ ] Task 6: Event types (Started, Ended, Expired)
- [ ] Task 7: CDK prop for max duration
- [ ] Task 8: Tests
- [ ] Task 9: Documentation update

## Resolved Decisions

1. **`ImpersonationExpired` event** — deferred from the authorizer. Will be implemented via DynamoDB Streams: a separate Lambda subscribes to session table TTL deletions, checks for `impersonatedBy`, and emits the event. This is an **optional CDK setting** (`impersonationExpiredEvents: true`) since it adds a Stream + Lambda (cost and complexity). Not required for core impersonation functionality.

2. **`endImpersonation` routing** — reads `__Host-SID` directly from the cookie and looks up the session in DynamoDB within the handler. Same pattern as `signOut`. Stays on the auth function URL behind CloudFront OAC, no additional Lambda or API Gateway route needed.

3. **Session refresh** — impersonation sessions use the same refresh/rotation mechanism as normal sessions. Same 15s drift, same rotation logic. The max age cap (default 1h, max 4h) is enforced at creation time and carried through refreshes. No special-casing needed.
