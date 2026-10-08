import { getRequestEvent, query } from "$app/server";
import * as v from "valibot";

import { toRemoteError } from "#lib/server/httpErrors.js";

const listRecipientsSchema = v.object({
  cursor: v.optional(v.string()),
});

export const listRecipients = query(listRecipientsSchema, async ({ cursor }) => {
  const { locals } = getRequestEvent();
  try {
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
  } catch (error) {
    toRemoteError(error, { redirectOnUnauthorized: true });
  }
});

export const listRecipientEmails = query(async () => {
  const { locals } = getRequestEvent();
  try {
    return await locals.services.recipients.listEmails();
  } catch (error) {
    toRemoteError(error, { redirectOnUnauthorized: true });
  }
});

const getRecipientSchema = v.object({
  email: v.string(),
  year: v.optional(v.number()),
  month: v.optional(v.number()),
  cursor: v.optional(v.string()),
});

export const getRecipient = query(getRecipientSchema, async ({ email, year, month, cursor }) => {
  const { locals } = getRequestEvent();
  try {
    const now = new Date();
    const resolvedYear = year ?? now.getUTCFullYear();
    const resolvedMonth = month ?? now.getUTCMonth() + 1;

    const [statsResult, history] = await Promise.all([
      locals.services.recipients.getStats({ email }),
      locals.services.messages.messageManyByRecipient({
        email,
        limit: 100,
        cursor,
      }),
    ]);

    return {
      email: statsResult.email,
      stats: statsResult.stats,
      year: resolvedYear,
      month: resolvedMonth,
      items: history.items.map((message) => ({
        id: message.id,
        createdAt: message.createdAt,
        subject: message.subject,
        status: message.status,
      })),
      cursor: history.cursor ?? null,
    };
  } catch (error) {
    toRemoteError(error, { redirectOnUnauthorized: true });
  }
});
