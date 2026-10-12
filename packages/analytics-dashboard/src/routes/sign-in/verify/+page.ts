import { redirect } from "@sveltejs/kit";

import type { PageLoad } from "./$types.js";

export const load: PageLoad = ({ url }) => {
  const token = url.searchParams.get("token");
  if (!token) redirect(303, "/sign-in");

  const referenceCode = url.searchParams.get("ref") ?? undefined;
  const expiresAt = url.searchParams.get("expires") ?? undefined;

  return { token, referenceCode, expiresAt };
};
