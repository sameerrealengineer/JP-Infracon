import {
  getSessionCookieName,
  getSessionCookieOptions,
  currentSessionCookie,
} from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import {
  bootstrapFirstSuperAdmin,
  bootstrapStatus,
  changeOwnPassword,
  credentialSessionLifetimeMs,
  passwordLogin,
  revokeSession,
} from "./_core/credential-auth";
import { sdk } from "./_core/sdk";
import { jpRouter } from "./jp/router";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(({ ctx }) => {
      if (!ctx.user) return null;
      return {
        id: ctx.user.id,
        name: ctx.user.name,
        email: ctx.user.email,
        loginMethod: ctx.user.loginMethod,
        accountStatus: ctx.user.accountStatus,
        platformOwner: ctx.user.role === "super_admin",
        platformRole: ctx.user.role,
        mustChangePassword: ctx.user.mustChangePassword ?? false,
        lastSignedIn: ctx.user.lastSignedIn,
      };
    }),
    bootstrapStatus: publicProcedure.query(() => bootstrapStatus()),
    login: publicProcedure
      .input(
        z.object({
          username: z.string().trim().min(3).max(32),
          password: z.string().min(1).max(128),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const result = await passwordLogin(input.username, input.password);
        ctx.res.cookie(getSessionCookieName(ctx.req), result.sessionToken, {
          ...getSessionCookieOptions(ctx.req),
          maxAge: credentialSessionLifetimeMs,
        });
        const webClient = ctx.req.headers["x-jp-client-platform"] === "web";
        return { user: result.user, sessionToken: webClient ? null : result.sessionToken };
      }),
    bootstrapFirstSuperAdmin: publicProcedure
      .input(
        z.object({
          bootstrapSecret: z.string().trim().min(1).max(512),
          username: z.string().trim().min(3).max(32),
          displayName: z.string().trim().min(2).max(120),
          password: z.string().min(12).max(128),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const result = await bootstrapFirstSuperAdmin(input);
        ctx.res.cookie(getSessionCookieName(ctx.req), result.sessionToken, {
          ...getSessionCookieOptions(ctx.req),
          maxAge: credentialSessionLifetimeMs,
        });
        const webClient = ctx.req.headers["x-jp-client-platform"] === "web";
        return { user: result.user, sessionToken: webClient ? null : result.sessionToken };
      }),
    changePassword: publicProcedure
      .input(
        z.object({
          currentPassword: z.string().min(1).max(128),
          newPassword: z.string().min(12).max(128),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user)
          throw new (await import("@trpc/server")).TRPCError({
            code: "UNAUTHORIZED",
            message: "Sign in to change your password.",
          });
        const result = await changeOwnPassword(
          ctx.user.id,
          input.currentPassword,
          input.newPassword,
        );
        ctx.res.cookie(getSessionCookieName(ctx.req), result.sessionToken, {
          ...getSessionCookieOptions(ctx.req),
          maxAge: credentialSessionLifetimeMs,
        });
        const webClient = ctx.req.headers["x-jp-client-platform"] === "web";
        return { user: result.user, sessionToken: webClient ? null : result.sessionToken };
      }),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      const authHeader = ctx.req.headers.authorization || ctx.req.headers.Authorization;
      const token =
        typeof authHeader === "string" && authHeader.startsWith("Bearer ")
          ? authHeader.slice("Bearer ".length).trim()
          : currentSessionCookie(ctx.req);
      if (token) {
        const session = await sdk.verifySession(token);
        if (session?.sessionId) await revokeSession(session.sessionId);
      }
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(getSessionCookieName(ctx.req), {
        ...cookieOptions,
        maxAge: -1,
      });
      return { success: true } as const;
    }),
  }),
  jp: jpRouter,
});

export type AppRouter = typeof appRouter;
