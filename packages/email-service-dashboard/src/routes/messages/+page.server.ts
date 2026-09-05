import type { PageServerLoad } from "./$types.js";

export const load: PageServerLoad = async ({ locals, url }) => {
  const now = new Date();
  const year = parseIntOr(url.searchParams.get("year"), now.getUTCFullYear());
  const month = parseIntOr(url.searchParams.get("month"), now.getUTCMonth() + 1);
  const cursor = url.searchParams.get("cursor") ?? undefined;

  const result = await locals.services.messages.messagesManyForMonth({
    month: { year, month },
    limit: 100,
    cursor,
  });

  return {
    year,
    month,
    items: result.items.map((message) => ({
      id: message.id,
      createdAt: message.createdAt,
      recipients: message.recipients,
      subject: message.subject,
      status: message.status,
    })),
    cursor: result.cursor ?? null,
  };
};

function parseIntOr(value: string | null, fallback: number): number {
  if (value == null) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return parsed;
}
