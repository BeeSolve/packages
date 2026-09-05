import { fail, redirect } from "@sveltejs/kit";
import * as v from "valibot";

import type { Actions, PageServerLoad } from "./$types.js";

export const load: PageServerLoad = async ({ locals }) => {
  const isComplete = await locals.services.setup.isComplete();
  if (isComplete) redirect(303, "/sign-in");
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const isComplete = await locals.services.setup.isComplete();
    if (isComplete) redirect(303, "/sign-in");

    const formData = await request.formData();
    const email = formData.get("email");

    const emailResult = v.safeParse(v.pipe(v.string(), v.email()), email);
    if (!emailResult.success) {
      return fail(400, { error: "Please enter a valid email address." });
    }

    const validEmail = emailResult.output;

    try {
      await locals.services.authClient.invoke({
        type: "newEmailAccount",
        request: { emailAddress: validEmail, accountId: validEmail },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("already exists") && !message.includes("AlreadyExists")) {
        return fail(500, { error: "Failed to create auth account. Please try again." });
      }
    }

    try {
      await locals.services.users.create({ email: validEmail, type: "admin" });
    } catch {
      return fail(500, { error: "Failed to create user record. Please try again." });
    }

    try {
      await locals.services.setup.markComplete({ adminEmail: validEmail });
    } catch {
      return fail(500, { error: "Failed to complete setup. Please try again." });
    }

    redirect(303, "/sign-in");
  },
};
