import { randomUUID } from 'node:crypto';
import { passkey } from '@better-auth/passkey';
import { assertEmailDomainAllowed } from '@orbit/core';
import { db, eq, schema } from '@orbit/db';
import { inviteEmail, magicLinkEmail, resetPasswordEmail, sendEmail } from '@orbit/services/email';
import { DomainError } from '@orbit/shared/errors';
import { slugify } from '@orbit/shared/utils';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { magicLink, organization } from 'better-auth/plugins';
import { z } from 'zod';
import { isDevLoginRequest } from '@/lib/api/dev-login.ts';
import { serverEnv } from '@/lib/env.ts';

const passkeyAssertionSchema = z.object({ response: z.object({ id: z.string().min(1) }) });

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

function handleFor(email: string, name: string): string {
  const base = slugify(name) || slugify(email.split('@')[0] ?? '') || 'member';
  return `${base}-${randomUUID().replaceAll('-', '').slice(0, 10)}`;
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
      hash: (password: string) => Bun.password.hash(password, { algorithm: 'argon2id' }),
      verify: ({ hash, password }: { hash: string; password: string }) =>
        Bun.password.verify(password, hash),
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

export const auth = betterAuth({
  appName: 'Orbit',
  baseURL: serverEnv().BETTER_AUTH_URL,
  secret: serverEnv().BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  emailAndPassword: emailAndPassword(),
  ...rateLimit(),
  socialProviders: socialProviders(),
  account: { accountLinking: { enabled: true, allowUnlinkingAll: true } },
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
      if (ctx.path === '/passkey/verify-authentication') await touchPasskeyLastUsed(ctx.body);
    }),
  },
  databaseHooks: {
    user: {
      create: {
        before: (user) => {
          assertSignUpAllowed(user.email);
          return Promise.resolve({
            data: { ...user, handle: handleFor(user.email, user.name) },
          });
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
    passkey({ rpName: 'Orbit' }),
    magicLink({
      sendMagicLink: async ({ email, url, token }, request) => {
        if (isDevLoginRequest(request)) return;
        assertSignUpAllowed(email);
        const content = await magicLinkEmail({ url, email });
        await sendEmail(db, {
          to: email,
          subject: content.subject,
          html: content.html,
          text: content.text,
          template: 'magic-link',
          idempotencyKey: `magic-link:${token}`,
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
    nextCookies(),
  ],
});

export type Auth = typeof auth;
export type Session = Awaited<ReturnType<typeof auth.api.getSession>>;
