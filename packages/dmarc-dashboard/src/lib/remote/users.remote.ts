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
    requireAdmin();
    const allUsers = await locals.services.users.listAll();
    return {
      users: allUsers.map((record) => ({
        email: record.email,
        type: record.type,
        domains: record.domains,
        createdAt: record.createdAt,
      })),
    };
  } catch (thrown) {
    toRemoteError(thrown, { redirectOnUnauthorized: true });
  }
});

export const listAvailableDomains = query(async () => {
  const { locals } = getRequestEvent();
  try {
    requireAdmin();
    const allDomains = await locals.services.domains.list();
    return { availableDomains: allDomains.map((domain) => domain.domain) };
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
    const allDomains = await locals.services.domains.list();
    return {
      targetUser: {
        email: targetUser.email,
        type: targetUser.type,
        domains: targetUser.domains,
      },
      availableDomains: allDomains.map((domain) => domain.domain),
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
  domains: v.array(v.string()),
});

export const inviteUser = form(inviteUserSchema, async ({ email, domains }) => {
  const { locals } = getRequestEvent();

  requireAdmin();

  if (domains.length === 0) {
    invalid("Please select at least one domain.");
  }

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
    await locals.services.users.create({ email, type: "user", domains });
  } catch (thrown) {
    toRemoteError(thrown);
  }

  await locals.services.email.sendEmail({
    recipients: [email],
    subject: "You've been invited to DMARC Dashboard",
    html: `<p>Hi,</p>
<p>You've been invited to the DMARC Dashboard. You can sign in at any time using your email address — a one-time code will be sent to verify your identity.</p>
<p>Your assigned domains: <strong>${domains.join(", ")}</strong></p>
<p>— DMARC Dashboard</p>`,
    text: `Hi,\n\nYou've been invited to the DMARC Dashboard. You can sign in at any time using your email address — a one-time code will be sent to verify your identity.\n\nYour assigned domains: ${domains.join(", ")}\n\n— DMARC Dashboard`,
  });

  redirect(303, "/users");
});

const updateUserSchema = v.object({
  email: v.string(),
  type: v.picklist(userTypes),
  domains: v.array(v.string()),
});

export const updateUser = form(updateUserSchema, async ({ email, type, domains }) => {
  const { locals } = getRequestEvent();

  const currentUser = requireAdmin();
  if (email === currentUser.email) {
    invalid("You cannot change your own role.");
  }

  try {
    await Promise.all([
      locals.services.users.updateDomains({ email, domains }),
      locals.services.users.updateType({ email, type }),
    ]);
  } catch (thrown) {
    toRemoteError(thrown);
  }

  redirect(303, "/users");
});
