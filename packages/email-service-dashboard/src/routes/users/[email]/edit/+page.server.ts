import { userTypes } from "$lib/server/users";
import { error, fail, redirect } from "@sveltejs/kit";
import * as v from "valibot";

import type { Actions, PageServerLoad } from "./$types.js";

export const load: PageServerLoad = async ({ locals, params }) => {
  const user = locals.user;
  if (user == null || user.type !== "admin") {
    error(403, "Access denied");
  }

  const targetEmail = decodeURIComponent(params.email);

  try {
    const targetUser = await locals.services.users.getByEmail({ email: targetEmail });

    return {
      targetUser: {
        email: targetUser.email,
        type: targetUser.type,
      },
      userTypes,
    };
  } catch {
    error(404, "User not found");
  }
};

export const actions: Actions = {
  default: async ({ request, locals, params }) => {
    const user = locals.user;
    if (user == null || user.type !== "admin") {
      error(403, "Access denied");
    }

    const targetEmail = decodeURIComponent(params.email);

    if (targetEmail === user.email) {
      return fail(400, { error: "You cannot change your own role." });
    }

    const formData = await request.formData();
    const selectedType = formData.get("type");

    const typeResult = v.safeParse(v.picklist(userTypes), selectedType);
    if (!typeResult.success) {
      return fail(400, { error: "Invalid user type." });
    }

    const validType = typeResult.output;

    try {
      await locals.services.users.updateType({ email: targetEmail, type: validType });
    } catch (updateError) {
      if (updateError instanceof Error && updateError.name === "UserNotFoundError") {
        error(404, "User not found");
      }
      return fail(500, { error: "Failed to update user. Please try again." });
    }

    redirect(303, "/users");
  },
};
