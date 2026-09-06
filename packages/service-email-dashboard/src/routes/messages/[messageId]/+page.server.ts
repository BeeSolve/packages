import { error } from "@sveltejs/kit";

import type { Actions, PageServerLoad } from "./$types.js";

export const load: PageServerLoad = async ({ locals, params }) => {
  const message = await locals.services.messages.getById({ messageId: params.messageId });
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
};

// Default (unnamed) form action — named `?/` actions break behind CloudFront
// in the kit-on-lambda deployment (see sveltekit-lambda steering). The request
// body is fetched on demand (not in `load`) so the JSON is only read from S3
// when the user explicitly asks for it.
export const actions: Actions = {
  default: async ({ locals, params }) => {
    const request = await locals.services.requests.get({ messageId: params.messageId });

    if (request == null) {
      return { bodyUnavailable: true };
    }

    return { request };
  },
};
