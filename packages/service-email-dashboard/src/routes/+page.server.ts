import type { PageServerLoad } from "./$types.js";

export const load: PageServerLoad = async ({ locals }) => {
  const now = new Date();
  const currentMonth = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };

  const [stats, recent] = await Promise.all([
    locals.services.globalStats.get(),
    locals.services.messages.messagesManyForMonth({ month: currentMonth, limit: 30 }),
  ]);

  return {
    stats,
    recent: recent.items.map((message) => ({
      id: message.id,
      createdAt: message.createdAt,
      recipients: message.recipients,
      subject: message.subject,
      status: message.status,
    })),
    // Average delivery latency across the recent window: deliveryMs lives on
    // delivered log entries inside logByRecipient. Computing it over 30 already
    // fetched messages is cheap, so we surface it here.
    averageDeliveryMs: averageDeliveryMs(recent.items),
  };
};

function averageDeliveryMs(
  messages: Awaited<
    ReturnType<App.Locals["services"]["messages"]["messagesManyForMonth"]>
  >["items"],
): number | null {
  const samples = new Array<number>();

  for (const message of messages) {
    for (const entries of Object.values(message.logByRecipient)) {
      for (const entry of entries) {
        if (entry.status === "delivered") samples.push(entry.deliveryMs);
      }
    }
  }

  if (samples.length === 0) return null;

  const total = samples.reduce((sum, value) => sum + value, 0);
  return Math.round(total / samples.length);
}
