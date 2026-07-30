import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCContext, createTRPCOptionsProxy } from "@trpc/tanstack-react-query";

import type { AppRouter } from "../../api/router.ts";

export const trpcClient = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: "/api" })],
});

export const queryClient = new QueryClient();

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});
