import { z } from 'zod';
import { isReservedWorkspaceSlug, ORG_ROLES } from '../constants/index.ts';
import { SLUG_PATTERN } from '../constants/pattern.ts';
import { emailSchema, idSchema } from './common.ts';

export const workspaceSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(48)
  .regex(SLUG_PATTERN, 'Use lowercase letters, numbers and dashes.')
  .refine((value) => !isReservedWorkspaceSlug(value), {
    message: 'That workspace address is reserved. Pick another.',
  });

export const organizationCreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: workspaceSlugSchema,
});

export const organizationUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(64),
    logo: z.string().url().max(2048).nullable(),
    allowedEmailDomains: z.array(z.string().trim().toLowerCase().min(1).max(255)).max(20),
  })
  .partial();

export const inviteCreateSchema = z.object({
  email: emailSchema,
  role: z.enum(ORG_ROLES).default('member'),
  teamIds: z.array(idSchema).max(50).default([]),
});

export const inviteBulkSchema = z.object({
  invites: z.array(inviteCreateSchema).min(1).max(100),
});

export const memberUpdateSchema = z.object({
  role: z.enum(ORG_ROLES),
});

export type OrganizationCreateInput = z.infer<typeof organizationCreateSchema>;
export type InviteCreateInput = z.infer<typeof inviteCreateSchema>;
