import * as v from "valibot";

export class AuthError extends Error {
  readonly status: number;
  readonly type: string;

  constructor(status: number, type: string, message?: string) {
    super(message ?? `Auth error: ${type}`);
    this.status = status;
    this.type = type;
  }
}

const authErrorSchema = v.object({
  type: v.string(),
  message: v.optional(v.string()),
});

const signInRequestSchema = v.object({
  token: v.string(),
  referenceCode: v.optional(v.string()),
  canResendAt: v.optional(v.string()),
});

const signInCompleteSchema = v.object({
  redirectTo: v.string(),
});

const resendCodeSchema = v.object({
  token: v.string(),
  referenceCode: v.string(),
  canResendAt: v.string(),
});

export type SignInRequestResult = v.InferOutput<typeof signInRequestSchema>;
export type ResendCodeResult = v.InferOutput<typeof resendCodeSchema>;

async function postJson<T>(
  path: string,
  body: unknown,
  schema: v.GenericSchema<unknown, T>,
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  });

  if (!response.ok) {
    let type = "unknown";
    try {
      const errorData = v.parse(authErrorSchema, await response.json());
      type = errorData.type;
    } catch {
      // ignore parse failure, use default type
    }
    throw new AuthError(response.status, type);
  }

  const data = await response.json();
  return v.parse(schema, data);
}

export async function signInRequest(emailAddress: string): Promise<SignInRequestResult> {
  return postJson("/auth/signInRequest", { emailAddress }, signInRequestSchema);
}

export async function signInComplete(token: string, code: string): Promise<void> {
  const response = await fetch("/auth/signInComplete", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ token, code }),
    credentials: "include",
  });

  if (!response.ok) {
    let type = "unknown";
    try {
      const errorData = v.parse(authErrorSchema, await response.json());
      type = errorData.type;
    } catch {
      // ignore parse failure, use default type
    }
    throw new AuthError(response.status, type);
  }

  const { redirectTo } = v.parse(signInCompleteSchema, await response.json());
  window.location.href = redirectTo;
}

export async function resendCode(token: string): Promise<ResendCodeResult> {
  return postJson("/auth/resendCode", { token }, resendCodeSchema);
}

export async function signOut(): Promise<void> {
  const response = await fetch("/auth/signOut", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({}),
    credentials: "include",
  });

  if (!response.ok) {
    throw new AuthError(response.status, "unknown");
  }

  const { redirectTo } = await response.json();
  window.location.href = redirectTo ?? "/";
}
