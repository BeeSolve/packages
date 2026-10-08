import { command, getRequestEvent, query } from "$app/server";
import { error } from "@sveltejs/kit";
import * as v from "valibot";

import { toRemoteError } from "#lib/server/httpErrors.js";

const listMessagesSchema = v.object({
  year: v.optional(v.number()),
  month: v.optional(v.number()),
  cursor: v.optional(v.string()),
});

export const listMessages = query(listMessagesSchema, async ({ year, month, cursor }) => {
  const { locals } = getRequestEvent();
  try {
    const now = new Date();
    const resolvedYear = year ?? now.getUTCFullYear();
    const resolvedMonth = month ?? now.getUTCMonth() + 1;

    const result = await locals.services.messages.messagesManyForMonth({
      month: { year: resolvedYear, month: resolvedMonth },
      limit: 100,
      cursor,
    });

    return {
      year: resolvedYear,
      month: resolvedMonth,
      items: result.items.map((message) => ({
        id: message.id,
        createdAt: message.createdAt,
        recipients: message.recipients,
        subject: message.subject,
        status: message.status,
      })),
      cursor: result.cursor ?? null,
    };
  } catch (thrown) {
    toRemoteError(thrown, { redirectOnUnauthorized: true });
  }
});

const getMessageSchema = v.object({
  messageId: v.string(),
});

export const getMessage = query(getMessageSchema, async ({ messageId }) => {
  const { locals } = getRequestEvent();
  try {
    const message = await locals.services.messages.getById({ messageId });
    if (message == null) {
      error(404, "Message not found");
    }

    return {
      message: {
        id: message.id,
        subject: message.subject,
        sender: message.sender,
        status: message.status,
        recipients: message.recipients,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
        requestId: message.requestId,
        logByRecipient: message.logByRecipient,
      },
    };
  } catch (thrown) {
    toRemoteError(thrown, { redirectOnUnauthorized: true });
  }
});

const loadMessageBodySchema = v.object({
  messageId: v.string(),
});

export const loadMessageBody = command(loadMessageBodySchema, async ({ messageId }) => {
  const { locals } = getRequestEvent();
  try {
    const request = await locals.services.requests.get({ messageId });
    if (request == null) {
      return { bodyUnavailable: true as const, request: null };
    }

    return { bodyUnavailable: false as const, request };
  } catch (thrown) {
    toRemoteError(thrown, { redirectOnUnauthorized: true });
  }
});
