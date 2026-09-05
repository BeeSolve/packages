import type { PageServerLoad } from "./$types.js";

export const load: PageServerLoad = async ({ locals, url }) => {
  const cursor = url.searchParams.get("cursor") ?? undefined;

  const result = await locals.services.recipients.list({ limit: 100, cursor });

  return {
    items: result.items.map((recipient) => ({
      email: recipient.pk,
      received: recipient.received,
      sent: recipient.sent,
      delivered: recipient.delivered,
      bounced: recipient.bounced,
      complained: recipient.complained,
      rejected: recipient.rejected,
      failed: recipient.failed,
    })),
    cursor: result.cursor ?? null,
  };
};
