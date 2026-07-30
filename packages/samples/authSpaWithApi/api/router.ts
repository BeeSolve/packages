import { initTRPC, TRPCError } from "@trpc/server";

import type { Context } from "./context.ts";

const t = initTRPC.context<Context>().create();

const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (ctx.userId == null) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { userId: ctx.userId } });
});

export const appRouter = t.router({
  identity: protectedProcedure.query(({ ctx }) => {
    return { userId: ctx.userId };
  }),
});

export type AppRouter = typeof appRouter;
