import { redirect } from "@sveltejs/kit";

import type { LayoutServerLoad } from "./$types.js";

export const load: LayoutServerLoad = ({ locals }) => {
  if (locals.session.type === "valid") redirect(303, "/");
};
