import { asLambdaAuthorizedHttpV2Handler } from "@beesolve/lambda-fetch-api";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { createContext } from "./context.ts";
import { appRouter } from "./router.ts";

async function fetch(request: Request): Promise<Response> {
  return fetchRequestHandler({
    endpoint: "/api",
    req: request,
    router: appRouter,
    createContext,
  });
}

export const handler = asLambdaAuthorizedHttpV2Handler(fetch);
