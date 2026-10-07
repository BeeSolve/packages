import type { RequestHandler } from "./$types.js";

export const GET: RequestHandler = async ({ locals }) => {
  return Response.json(await locals.services.recipients.listEmails());
};
