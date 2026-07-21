import type { PageServerLoad } from "./$types.js";

export const load: PageServerLoad = ({ locals }) => {
  if (locals.session.type !== "valid") return { sessionId: null };
  return { sessionId: locals.session.validSession.sessionId };
};
