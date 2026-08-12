import { createHmac } from 'node:crypto';
import { passkey } from '@better-auth/passkey';
import {
  assertEmailDomainAllowed,
  ingestExternalAvatar,
  isExternalImageUrl,
  publishSessionRevoked,
} from '@orbit/core';
import { db, eq, inArray, schema } from '@orbit/db';
import { inviteEmail, resetPasswordEmail, sendEmail, signInCodeEmail } from '@orbit/services/email';
import { DomainError } from '@orbit/shared/errors';
import { type BetterAuthPlugin, betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { emailOTP, mcp, organization } from 'better-auth/plugins';
import { z } from 'zod';
import { isDevLoginRequest } from '@/lib/api/dev-login.ts';
import { mcpServerUrl, serverEnv } from '@/lib/env.ts';
import { uniqueHandleFor } from './handle.ts';
import { hashPassword, verifyPassword } from './password.ts';

export const MCP_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'orbit.read',
  'orbit.write',
] as const;

export const MCP_CONSENT_PATH = '/oauth/authorize';
export const MCP_LOGIN_PATH = '/login';
export const MCP_AUTHORIZE_START_PATH = '/api/oauth/start';
export const MCP_TOKEN_RATE_LIMIT_PROBE_HEADER = 'x-orbit-mcp-token-rate-limit-probe';

function mcpTokenRateLimitProbe() {
  return {
    id: 'orbit-mcp-token-rate-limit-probe' as const,
    onRequest(request: Request) {
      if (new URL(request.url).pathname !== '/api/auth/mcp/token') {
        return Promise.resolve(undefined);
      }
      if (request.headers.get(MCP_TOKEN_RATE_LIMIT_PROBE_HEADER) !== '1') {
        return Promise.resolve(undefined);
      }
      return Promise.resolve({ response: new Response(null, { status: 204 }) });
    },
  } satisfies BetterAuthPlugin;
}

const passkeyAssertionSchema = z.object({ response: z.object({ id: z.string().min(1) }) });

function verificationSucceeded(ctx: { context?: { returned?: unknown } }): boolean {
  const returned = ctx.context?.returned;
  if (returned === null || returned === undefined) return false;
  if (returned instanceof Error) return false;
  if (typeof returned === 'object' && 'error' in returned) {
    return (returned as { error: unknown }).error == null;
  }
  return true;
}

async function touchPasskeyLastUsed(body: unknown): Promise<void> {
  const parsed = passkeyAssertionSchema.safeParse(body);
  if (!parsed.success) return;
  await db
    .update(schema.passkey)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.passkey.credentialID, parsed.data.response.id));
}

const SESSION_CACHE_SECONDS = 5 * 60;
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const SESSION_REVOKING_PATHS = new Set([
  '/revoke-session',
  '/revoke-sessions',
  '/revoke-other-sessions',
]);

function socialProviders() {
  const env = serverEnv();
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {};
  const github =
    env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } }
      : {};
  return { ...google, ...github };
}

export const enabledSocialProviders: readonly string[] = Object.keys(socialProviders());

export const passwordAuthEnabled: boolean = serverEnv().ORBIT_PASSWORD_AUTH;

const SIGN_IN_ATTEMPTS_PER_MINUTE = 5;
const SIGN_UP_ATTEMPTS_PER_HOUR = 5;

async function takenHandles(candidates: readonly string[]): Promise<Set<string>> {
  const rows = await db
    .select({ handle: schema.user.handle })
    .from(schema.user)
    .where(inArray(schema.user.handle, [...candidates]));
  return new Set(rows.map((row) => row.handle));
}

function handleFor(email: string, name: string): Promise<string> {
  return uniqueHandleFor(email, name, takenHandles);
}

function emailAndPassword() {
  if (!passwordAuthEnabled) return { enabled: false } as const;
  return {
    enabled: true,
    minPasswordLength: 12,
    sendResetPassword: async (
      { user, url, token }: { user: { email: string }; url: string; token: string },
      request?: Request,
    ) => {
      if (isDevLoginRequest(request)) return;
      const content = await resetPasswordEmail({ url, email: user.email });
      await sendEmail(db, {
        to: user.email,
        subject: content.subject,
        html: content.html,
        text: content.text,
        template: 'reset-password',
        idempotencyKey: `reset-password:${token}`,
      });
    },
    password: {
      hash: (password: string) => hashPassword(password),
      verify: ({ hash, password }: { hash: string; password: string }) =>
        verifyPassword(hash, password),
    },
  } as const;
}

function rateLimit() {
  if (!passwordAuthEnabled) return {};
  return {
    rateLimit: {
      enabled: true,
      customRules: {
        '/sign-in/email': { window: 60, max: SIGN_IN_ATTEMPTS_PER_MINUTE },
        '/sign-up/email': { window: 3600, max: SIGN_UP_ATTEMPTS_PER_HOUR },
      },
    },
  };
}

function assertSignUpAllowed(email: string): void {
  try {
    assertEmailDomainAllowed(email);
  } catch (error: unknown) {
    if (error instanceof DomainError && error.code === 'forbidden') {
      throw new APIError('FORBIDDEN', {
        code: 'EMAIL_DOMAIN_NOT_ALLOWED',
        message: error.message,
      });
    }
    throw error;
  }
}

function signInCodeIdempotencyKey(email: string, otp: string): string {
  const digest = createHmac('sha256', serverEnv().BETTER_AUTH_SECRET)
    .update(`${email}:${otp}`)
    .digest('hex');
  return `sign-in-code:${digest}`;
}

export const auth = betterAuth({
  appName: 'Orbit',
  baseURL: serverEnv().BETTER_AUTH_URL,
  secret: serverEnv().BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  emailAndPassword: emailAndPassword(),
  ...rateLimit(),
  socialProviders: socialProviders(),
  account: {
    accountLinking: { enabled: true, allowUnlinkingAll: true, allowDifferentEmails: true },
  },
  session: {
    expiresIn: SESSION_MAX_AGE_SECONDS,
    cookieCache: { enabled: true, maxAge: SESSION_CACHE_SECONDS },
  },
  user: {
    additionalFields: {
      handle: { type: 'string', required: false, input: false },
      timezone: { type: 'string', required: false, input: false },
    },
  },
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/passkey/verify-authentication' && verificationSucceeded(ctx)) {
        await touchPasskeyLastUsed(ctx.body);
      }
      if (ctx.path !== undefined && SESSION_REVOKING_PATHS.has(ctx.path)) {
        const authed = await getSessionFromCtx(ctx);
        if (authed !== null) await publishSessionRevoked(authed.user.id);
      }
    }),
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          assertSignUpAllowed(user.email);
          return { data: { ...user, handle: await handleFor(user.email, user.name) } };
        },
        after: async (user) => {
          const image = user.image ?? null;
          if (isExternalImageUrl(image)) await ingestExternalAvatar(user.id, image);
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          const rows = await db
            .select({ email: schema.user.email })
            .from(schema.user)
            .where(eq(schema.user.id, session.userId))
            .limit(1);
          const email = rows[0]?.email;
          if (email !== undefined) assertSignUpAllowed(email);
          return { data: session };
        },
      },
    },
  },
  plugins: [
    mcpTokenRateLimitProbe(),
    passkey({ rpName: 'Orbit' }),
    emailOTP({
      storeOTP: 'hashed',
      sendVerificationOTP: async ({ email, otp, type }, context) => {
        if (isDevLoginRequest(context)) return;
        if (type !== 'sign-in') return;
        assertSignUpAllowed(email);
        const content = await signInCodeEmail({ code: otp, email });
        await sendEmail(db, {
          to: email,
          subject: content.subject,
          html: content.html,
          text: content.text,
          template: 'sign-in-code',
          idempotencyKey: signInCodeIdempotencyKey(email, otp),
        });
      },
    }),
    organization({
      sendInvitationEmail: async (data) => {
        const content = await inviteEmail({
          organizationName: data.organization.name,
          inviterName: data.inviter.user.name,
          role: data.role,
          acceptUrl: `${serverEnv().NEXT_PUBLIC_APP_URL}/invite/${data.id}`,
        });
        await sendEmail(db, {
          to: data.email,
          subject: content.subject,
          html: content.html,
          text: content.text,
          template: 'invite',
          idempotencyKey: `org-invite:${data.id}`,
        });
      },
    }),
    mcp({
      loginPage: MCP_LOGIN_PATH,
      resource: mcpServerUrl(),
      oidcConfig: {
        loginPage: MCP_LOGIN_PATH,
        consentPage: MCP_CONSENT_PATH,
        allowDynamicClientRegistration: true,
        requirePKCE: true,
        scopes: [...MCP_SCOPES],
      },
    }),
    nextCookies(),
  ],
});

export type Auth = typeof auth;
export type Session = Awaited<ReturnType<typeof auth.api.getSession>>;
