import { randomBytes } from "node:crypto";

import {
  ExpiredTokenError,
  TokenAlreadyUsedUpError,
  TokenInvalidError,
} from "@beesolve/action-tokens/model";
import type { ActionTokensClient } from "@beesolve/action-tokens/sdk";
import { asNull, call } from "@beesolve/helpers";
import * as v from "valibot";

import type { Accounts } from "../account.ts";
import { addSetCookies } from "../cookie.ts";
import { BadRequestError } from "../errors.ts";
import type { Events } from "../events.ts";
import { parseBody } from "../request.ts";
import { Sessions } from "../session.ts";

interface Dependencies {
  readonly actionTokens: Pick<ActionTokensClient, "use">;
  readonly sessions: Pick<Sessions, "createOne">;
  readonly accounts: Pick<Accounts, "getOne" | "createNew">;
  readonly events: Pick<Events, "putEvents">;
  readonly headers: Headers;
  // oxlint-disable-next-line typescript/no-explicit-any
  readonly requestBody: () => Promise<any>;
  readonly allowSignUp: boolean;
  readonly dataToken: string | undefined;
}

const safeRedirectTo = v.pipe(
  v.string(),
  v.transform(decodeURIComponent),
  v.regex(/^\/(?!\/)/, "redirectTo must be a relative path"),
);

const schema = v.object({
  code: v.pipe(v.string(), v.length(6), v.digits()),
  token: v.string(),
  redirectTo: v.optional(safeRedirectTo),
});

export async function signInComplete({
  actionTokens,
  sessions,
  accounts,
  requestBody,
  headers,
  events,
  allowSignUp,
  dataToken,
}: Dependencies): Promise<Response> {
  const { code, token, redirectTo } = parseBody({
    body: await requestBody(),
    schema,
  });

  const { data } = await actionTokens
    .use({
      action: "signInRequest",
      value: code,
      drainWhenValid: true,
      owner: token,
    })
    .catch(async (error) => {
      if (
        error instanceof TokenInvalidError ||
        error instanceof ExpiredTokenError ||
        error instanceof TokenAlreadyUsedUpError
      ) {
        await events.putEvents({
          type: "UnsuccessfulAuth",
          detail: { emailAddress: null, reason: error.message },
        });
      }
      throw error;
    });

  const result = v.safeParse(v.object({ emailAddress: v.pipe(v.string(), v.email()) }), data);

  if (!result.success) throw new BadRequestError("Invalid token.");

  const account = await upsertAccount({
    emailAddress: result.output.emailAddress,
    allowSignUp,
    dataToken,
  });

  const session = await sessions.createOne({
    userId: account.id,
    data: Sessions.dataFromCloudFrontHeaders(Object.fromEntries(headers.entries())),
  });

  return new Response(null, {
    status: 301,
    headers: addSetCookies({
      headers: new Headers({
        "Cache-Control": "no-store",
        Location: redirectTo ?? "/",
      }),
      cookies: [
        {
          sid: session.id,
          maxAge: session.maxAge,
        },
      ],
    }),
  });

  async function upsertAccount(props: {
    readonly emailAddress: string;
    readonly allowSignUp: boolean;
    readonly dataToken: string | undefined;
  }) {
    const [account, isNew] = await call(async () => {
      const account = await accounts.getOne(props.emailAddress).catch(asNull);
      if (account != null) return [account, false];

      if (!props.allowSignUp) {
        await events.putEvents({
          type: "UnsuccessfulAuth",
          detail: { emailAddress: props.emailAddress, reason: "Email not registered." },
        });
        throw new BadRequestError("Email not registered.");
      }

      return [
        await accounts.createNew({
          id: randomBytes(32).toString("base64url"),
          type: "email",
          username: props.emailAddress,
        }),
        true,
      ];
    });

    const promises = new Array();
    if (isNew) {
      promises.push(
        events.putEvents({
          type: "EmailAddressVerified",
          detail: {
            accountId: account.id,
            emailAddress: props.emailAddress,
            verifiedAt: new Date().toISOString(),
          },
        }),
      );
    }

    if (dataToken) {
      promises.push(
        events.putEvents({
          type: "DataToken",
          detail: {
            accountId: account.id,
            emailAddress: props.emailAddress,
            dataToken,
          },
        }),
      );
    }

    await Promise.all(promises);

    return account;
  }
}
