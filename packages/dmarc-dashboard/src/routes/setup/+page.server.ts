import { redirect } from "@sveltejs/kit";

import type { PageServerLoad } from "./$types.js";

export const load: PageServerLoad = async ({ locals }) => {
  const isComplete = await locals.services.setup.isComplete();
  if (isComplete) redirect(303, "/sign-in");
};
