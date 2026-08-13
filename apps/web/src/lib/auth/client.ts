'use client';

import { passkeyClient } from '@better-auth/passkey/client';
import { emailOTPClient, organizationClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import { publicAppUrl } from '@/lib/env.ts';

export const authClient = createAuthClient({
  baseURL: publicAppUrl(),
  plugins: [passkeyClient(), emailOTPClient(), organizationClient()],
});

export const { signIn, signOut, signUp, useSession } = authClient;
