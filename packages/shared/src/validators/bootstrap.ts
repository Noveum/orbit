import { z } from 'zod';

export const bootstrapQuerySchema = z.object({
  team: z
    .string()
    .trim()
    .min(1)
    .max(16)
    .transform((value) => value.toUpperCase())
    .optional(),
});
