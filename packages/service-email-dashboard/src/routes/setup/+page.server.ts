import { redirect } from "@sveltejs/kit";

import type { PageServerLoad } from "./$types.js";

export const load: PageServerLoad = async ({ locals }) => {
  const setup = await locals.services.setup.get();
  if (setup != null) redirect(303, "/sign-in");
};
