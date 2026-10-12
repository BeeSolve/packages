import { error } from "@sveltejs/kit";

type User = NonNullable<App.Locals["user"]>;

export function requireUser(locals: App.Locals): User {
  const { user } = locals;
  if (user == null) {
    error(403, "Access denied");
  }
  return user;
}

export function requireAdmin(locals: App.Locals): User {
  const user = requireUser(locals);
  if (user.type !== "admin") {
    error(403, "Access denied — admin only");
  }
  return user;
}
