import { passkey } from '@better-auth/passkey';
import { db, schema } from '@orbit/db';
import { slugify } from '@orbit/shared/utils';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { magicLink, organization } from 'better-auth/plugins';
import { serverEnv } from '@/lib/env.ts';
import { sendAuthEmail } from './email.ts';

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

function handleFor(email: string, name: string): string {
  const base = slugify(name) || slugify(email.split('@')[0] ?? '') || 'member';
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

export const auth = betterAuth({
  appName: 'Orbit',
  baseURL: serverEnv().BETTER_AUTH_URL,
  secret: serverEnv().BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  emailAndPassword: { enabled: false },
  socialProviders: socialProviders(),
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
  databaseHooks: {
    user: {
      create: {
        before: (user) =>
          Promise.resolve({
            data: { ...user, handle: handleFor(user.email, user.name) },
          }),
      },
    },
  },
  plugins: [
    passkey({ rpName: 'Orbit' }),
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        await sendAuthEmail({
          to: email,
          subject: 'Your Orbit sign in link',
          text: `Open this link to sign in to Orbit. It expires in 5 minutes.\n${url}`,
          url,
        });
      },
    }),
    organization({
      sendInvitationEmail: async (data) => {
        await sendAuthEmail({
          to: data.email,
          subject: `${data.inviter.user.name} invited you to ${data.organization.name} on Orbit`,
          text: `Accept the invitation to join ${data.organization.name}.`,
          url: `${serverEnv().NEXT_PUBLIC_APP_URL}/invite/${data.id}`,
        });
      },
    }),
    nextCookies(),
  ],
});

export type Auth = typeof auth;
export type Session = Awaited<ReturnType<typeof auth.api.getSession>>;
