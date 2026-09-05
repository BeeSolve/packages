import type { EmailServiceError } from "@beesolve/email-service/sdk";
import { error, fail } from "@sveltejs/kit";

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
    // The body request is only reachable when a real requestId was captured.
    canRequestBody: message.requestId !== "unknown" && message.requestId.length > 0,
  };
};

// Default (unnamed) form action — named `?/` actions break behind CloudFront
// in the kit-on-lambda deployment (see sveltekit-lambda steering).
export const actions: Actions = {
  default: async ({ locals, params }) => {
    const message = await locals.services.messages.getById({ messageId: params.messageId });
    if (message == null) {
      error(404, "Message not found");
    }

    const requestId = message.requestId;
    if (requestId === "unknown" || requestId.length === 0) {
      return fail(400, { bodyError: "This message has no stored request body." });
    }

    try {
      const stored = await locals.services.email.getMessage(requestId);
      return {
        body: {
          html: stored.request.html,
          text: stored.request.text ?? null,
        },
      };
    } catch (caught) {
      if (isMessageNotFound(caught)) {
        return { bodyUnavailable: true };
      }
      throw caught;
    }
  },
};

// Detect EmailServiceError with a `message_not_found` code without a value
// import of the SDK: importing the SDK's value exports eagerly parses its
// required env vars at module load, which breaks SvelteKit's build-time route
// analysis under the placeholder build env. A structural guard keeps this
// module free of that side effect.
function isMessageNotFound(
  value: unknown,
): value is EmailServiceError & { code: "message_not_found" } {
  if (!(value instanceof Error)) return false;
  if (value.name !== "EmailServiceError") return false;
  return "code" in value && value.code === "message_not_found";
}
