import { fail, redirect } from "@sveltejs/kit";
import * as v from "valibot";

import type { Actions, PageServerLoad } from "./$types.js";

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.session.type !== "valid") {
    redirect(303, "/sign-in");
  }

  const { validSession } = locals.session;
  const allUsers = await locals.services.sampleUsers.listAll();

  return {
    users: allUsers.map((record) => ({
      email: record.email,
      userId: record.userId,
      createdAt: record.createdAt,
    })),
    identity: validSession.impersonating
      ? {
          userId: validSession.userId,
          impersonating: true as const,
          impersonatedBy: validSession.impersonatedBy,
        }
      : {
          userId: validSession.userId,
          impersonating: false as const,
        },
  };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    if (locals.session.type !== "valid") {
      redirect(303, "/sign-in");
    }

    const { validSession } = locals.session;

    if (validSession.impersonating) {
      return fail(400, { error: "Already impersonating. Stop impersonating first." });
    }

    const formData = await request.formData();
    const targetUserId = formData.get("targetUserId");

    const parsed = v.safeParse(v.pipe(v.string(), v.nonEmpty()), targetUserId);
    if (!parsed.success) {
      return fail(400, { error: "Invalid target user." });
    }

    if (parsed.output === validSession.userId) {
      return fail(400, { error: "You cannot impersonate yourself." });
    }

    await locals.services.authClient.invoke({
      type: "impersonate",
      request: {
        targetUserId: parsed.output,
        cookieHeader: request.headers.get("cookie") ?? "",
      },
    });

    redirect(303, "/");
  },
};
