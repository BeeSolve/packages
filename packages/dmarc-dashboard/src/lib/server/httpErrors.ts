import { ReportNotFoundError } from "@beesolve/dmarc-consumer/report";
import { error, isHttpError, isRedirect, redirect } from "@sveltejs/kit";

import { UserAlreadyExistsError, UserNotFoundError } from "#lib/server/users.js";

type User = NonNullable<App.Locals["user"]>;

/**
 * Maps our internal domain errors to SvelteKit `error(...)`/`redirect(...)`.
 * This function never returns (its return type is `never`): it always throws
 * via SvelteKit's `error`/`redirect`. Call it directly from within a `catch` in
 * a remote function - do NOT `throw` its result, since a `throw toRemoteError(e)`
 * form trips the `only-throw-error` lint rule:
 *
 *   try { ... } catch (error) { toRemoteError(error); }
 *
 * @param redirectOnUnauthorized when true (queries/forms), a `UserNotFoundError`
 *   becomes `redirect(303, "/sign-in")` instead of `error(404)`.
 */
export function toRemoteError(
  error_: unknown,
  { redirectOnUnauthorized = false }: { redirectOnUnauthorized?: boolean } = {},
): never {
  if (isRedirect(error_)) redirect(error_.status, error_.location);
  if (isHttpError(error_)) error(error_.status, error_.body.message);

  if (error_ instanceof UserAlreadyExistsError) error(400, error_.message);
  if (error_ instanceof ReportNotFoundError) error(404, error_.message);
  if (error_ instanceof UserNotFoundError) {
    if (redirectOnUnauthorized) redirect(303, "/sign-in");
    error(404, error_.message);
  }

  console.error(error_);

  error(500);
}

/**
 * Ensures a user is present on the request. Returns the non-null user record or
 * throws `error(401)`.
 */
export function requireUser(user: User | null): User {
  if (user == null) error(401);

  return user;
}
