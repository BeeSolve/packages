import { error } from "@sveltejs/kit";

type User = NonNullable<App.Locals["user"]>;

export function requireUser(locals: App.Locals): User {
  const { user } = locals;
  if (user == null) {
    error(403, "Access denied");
  }
  return user;
}

export function requireDomainAccess(props: {
  readonly locals: App.Locals;
  readonly domain: string;
}): User {
  const user = requireUser(props.locals);
  if (user.type !== "admin" && !user.domains.includes(props.domain)) {
    error(403, "Access denied — you do not have access to this domain");
  }
  return user;
}
