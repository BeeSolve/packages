class AuthError extends Error {
  public readonly stringified: boolean;

  constructor(message: unknown) {
    super(typeof message === "string" ? message : JSON.stringify(message));
    this.stringified = typeof message !== "string";
  }
}

export class NotFoundError extends AuthError {}
export class ForbiddenError extends AuthError {}
export class BadRequestError extends AuthError {}
export class UnauthorizedError extends AuthError {}
