import { form, getRequestEvent, query } from "$app/server";
import { error, invalid, redirect } from "@sveltejs/kit";
import * as v from "valibot";

import { requireUser, toRemoteError } from "#lib/server/httpErrors.js";
import { userTypes } from "#lib/server/users.js";

function requireAdmin(): NonNullable<App.Locals["user"]> {
  const { locals } = getRequestEvent();
  const currentUser = requireUser(locals.user);
  if (currentUser.type !== "admin") {
    error(403, "Access denied");
  }
  return currentUser;
}

export const listUsers = query(async () => {
  const { locals } = getRequestEvent();
  try {
    const currentUser = requireAdmin();
    const allUsers = await locals.services.users.listAll();
    return {
      users: allUsers.map((record) => ({
        email: record.email,
        type: record.type,
        createdAt: record.createdAt,
      })),
      currentUserEmail: currentUser.email,
    };
  } catch (thrown) {
    toRemoteError(thrown, { redirectOnUnauthorized: true });
  }
});

const getEditUserSchema = v.object({ email: v.string() });

export const getEditUser = query(getEditUserSchema, async ({ email }) => {
  const { locals } = getRequestEvent();
  try {
    requireAdmin();
    const targetUser = await locals.services.users.getByEmail({ email });
    return {
      targetUser: {
        email: targetUser.email,
        type: targetUser.type,
      },
      userTypes,
    };
  } catch (thrown) {
    toRemoteError(thrown, { redirectOnUnauthorized: true });
  }
});

const deleteUserSchema = v.object({
  email: v.pipe(v.string(), v.email("Invalid email address.")),
});

export const deleteUser = form(deleteUserSchema, async ({ email }) => {
  const { locals } = getRequestEvent();

  const currentUser = requireAdmin();
  if (email === currentUser.email) {
    invalid("You cannot delete your own account.");
  }

  try {
    await locals.services.authClient.invoke({
      type: "deleteAllSessions",
      request: { accountId: email },
    });

    await locals.services.users.delete({ email });
  } catch (thrown) {
    toRemoteError(thrown);
  }

  await listUsers().refresh();

  return { ok: true };
});

const inviteUserSchema = v.object({
  email: v.pipe(v.string(), v.email("Please enter a valid email address.")),
});

export const inviteUser = form(inviteUserSchema, async ({ email }) => {
  const { locals } = getRequestEvent();

  requireAdmin();

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
    await locals.services.users.create({ email, type: "user" });
  } catch (thrown) {
    toRemoteError(thrown);
  }

  await locals.services.email.sendEmail({
    recipients: [email],
    subject: "You've been invited to Email Dashboard",
    html: `<p>Hi,</p>
<p>You've been invited to the Email Dashboard. You can sign in at any time using your email address — a one-time code will be sent to verify your identity.</p>
<p>— Email Dashboard</p>`,
    text: `Hi,\n\nYou've been invited to the Email Dashboard. You can sign in at any time using your email address — a one-time code will be sent to verify your identity.\n\n— Email Dashboard`,
  });

  redirect(303, "/users");
});

const updateUserSchema = v.object({
  email: v.string(),
  type: v.picklist(userTypes),
});

export const updateUser = form(updateUserSchema, async ({ email, type }) => {
  const { locals } = getRequestEvent();

  const currentUser = requireAdmin();
  if (email === currentUser.email) {
    invalid("You cannot change your own role.");
  }

  try {
    await locals.services.users.updateType({ email, type });
  } catch (thrown) {
    toRemoteError(thrown);
  }

  redirect(303, "/users");
});
