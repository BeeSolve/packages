import { form, getRequestEvent } from "$app/server";
import { error, redirect } from "@sveltejs/kit";
import * as v from "valibot";

const completeSetupSchema = v.object({
  email: v.pipe(v.string(), v.email("Please enter a valid email address.")),
});

export const completeSetup = form(completeSetupSchema, async ({ email }) => {
  const { locals } = getRequestEvent();

  const setup = await locals.services.setup.get();
  if (setup != null) redirect(303, "/sign-in");

  try {
    await locals.services.authClient.invoke({
      type: "newEmailAccount",
      request: { emailAddress: email, accountId: email },
    });
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    if (!message.includes("already exists") && !message.includes("AlreadyExists")) {
      error(500, "Failed to create auth account. Please try again.");
    }
  }

  try {
    await locals.services.users.create({ email, type: "admin" });
  } catch {
    error(500, "Failed to create user record. Please try again.");
  }

  try {
    await locals.services.setup.markComplete({ adminEmail: email });
  } catch {
    error(500, "Failed to complete setup. Please try again.");
  }

  redirect(303, "/sign-in");
});
