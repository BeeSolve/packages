import type { PageServerLoad } from "./$types.js";

export const load: PageServerLoad = async ({ locals, params, url }) => {
  const now = new Date();
  const year = parseIntOr(url.searchParams.get("year"), now.getUTCFullYear());
  const month = parseIntOr(url.searchParams.get("month"), now.getUTCMonth() + 1);
  const cursor = url.searchParams.get("cursor") ?? undefined;

  const [statsResult, history] = await Promise.all([
    locals.services.recipients.getStats({ email: params.email }),
    locals.services.messages.messageManyByRecipient({
      email: params.email,
      limit: 100,
      cursor,
    }),
  ]);

  return {
    email: statsResult.email,
    stats: statsResult.stats,
    year,
    month,
    items: history.items.map((message) => ({
      id: message.id,
      createdAt: message.createdAt,
      subject: message.subject,
      status: message.status,
    })),
    cursor: history.cursor ?? null,
  };
};

function parseIntOr(value: string | null, fallback: number): number {
  if (value == null) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return parsed;
}
