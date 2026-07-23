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

export const devSignInSchema = z.object({ email: emailSchema });
