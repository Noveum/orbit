import { z } from 'zod';
import { emailSchema, idSchema } from './common.ts';

export const credentialRemoveSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('account'),
    providerId: z.string().trim().min(1).max(64),
    accountId: z.string().trim().min(1).max(255).optional(),
  }),
  z.object({ kind: z.literal('passkey'), id: idSchema }),
]);

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

export const setPasswordSchema = z.object({
  newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
});

export type SetPasswordInput = z.infer<typeof setPasswordSchema>;

export const devSignInSchema = z.object({ email: emailSchema });
