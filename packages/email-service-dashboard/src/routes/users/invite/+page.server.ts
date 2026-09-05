import { error, fail, redirect } from "@sveltejs/kit";
import * as v from "valibot";

import type { Actions, PageServerLoad } from "./$types.js";

export const load: PageServerLoad = async ({ locals }) => {
  const user = locals.user;
  if (user == null || user.type !== "admin") {
    error(403, "Access denied");
  }
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const user = locals.user;
    if (user == null || user.type !== "admin") {
      error(403, "Access denied");
    }

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
    } catch (invocationError) {
      const message =
        invocationError instanceof Error ? invocationError.message : String(invocationError);
      if (!message.includes("already exists") && !message.includes("AlreadyExists")) {
        return fail(500, { error: "Failed to create auth account. Please try again." });
      }
    }

    try {
      await locals.services.users.create({ email: validEmail, type: "user" });
    } catch (createError) {
      if (createError instanceof Error && createError.name === "UserAlreadyExistsError") {
        return fail(400, { error: "A user with this email already exists." });
      }
      return fail(500, { error: "Failed to create user record. Please try again." });
    }

    await locals.services.email.sendEmail({
      recipients: [validEmail],
      subject: "You've been invited to Email Dashboard",
      html: `<p>Hi,</p>
<p>You've been invited to the Email Dashboard. You can sign in at any time using your email address — a one-time code will be sent to verify your identity.</p>
<p>— Email Dashboard</p>`,
      text: `Hi,\n\nYou've been invited to the Email Dashboard. You can sign in at any time using your email address — a one-time code will be sent to verify your identity.\n\n— Email Dashboard`,
    });

    redirect(303, "/users");
  },
};
