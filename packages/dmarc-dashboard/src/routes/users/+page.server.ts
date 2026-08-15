import { error, fail, redirect } from "@sveltejs/kit";
import * as v from "valibot";

import type { Actions, PageServerLoad } from "./$types.js";

export const load: PageServerLoad = async ({ locals }) => {
  const user = locals.user;
  if (user == null || user.type !== "admin") {
    error(403, "Access denied");
  }

  const allUsers = await locals.services.users.listAll();

  return {
    users: allUsers.map((record) => ({
      email: record.email,
      type: record.type,
      domains: record.domains,
      createdAt: record.createdAt,
    })),
  };
};

export const actions: Actions = {
  delete: async ({ request, locals }) => {
    const user = locals.user;
    if (user == null || user.type !== "admin") {
      error(403, "Access denied");
    }

    const formData = await request.formData();
    const email = formData.get("email");

    const emailResult = v.safeParse(v.pipe(v.string(), v.email()), email);
    if (!emailResult.success) {
      return fail(400, { error: "Invalid email address." });
    }

    const targetEmail = emailResult.output;

    if (targetEmail === user.email) {
      return fail(400, { error: "You cannot delete your own account." });
    }

    await locals.services.authClient.invoke({
      type: "deleteAllSessions",
      request: { accountId: targetEmail },
    });

    await locals.services.users.delete({ email: targetEmail });
    redirect(303, "/users");
  },
};
