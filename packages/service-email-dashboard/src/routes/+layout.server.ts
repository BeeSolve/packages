import type { LayoutServerLoad } from "./$types.js";

export const load: LayoutServerLoad = async ({ locals }) => {
  const config = await locals.services.setup.get();
  if (config == null) {
    throw new Error("Setup config missing for authenticated session");
  }
  return {
    user: locals.user,
    startDate: config.completedAt,
  };
};
