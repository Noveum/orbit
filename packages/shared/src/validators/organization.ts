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

export const organizationDeleteSchema = z
  .object({
    confirmation: z
      .string()
      .min(1)
      .max(80)
      .refine((value) => value === value.trim()),
  })
  .strict();

export const organizationDeletionSummarySchema = z
  .object({
    organizationName: z.string(),
    members: z.number().int().nonnegative(),
    teams: z.number().int().nonnegative(),
    projects: z.number().int().nonnegative(),
    issues: z.number().int().nonnegative(),
    documents: z.number().int().nonnegative(),
    files: z.number().int().nonnegative(),
    fileBytes: z.number().int().nonnegative(),
    fileVersions: z.number().int().nonnegative(),
    fileVersionBytes: z.number().int().nonnegative(),
    integrations: z.number().int().nonnegative(),
    webhooks: z.number().int().nonnegative(),
    availableAt: z.string().datetime().nullable(),
    deletionRequestedAt: z.string().datetime().nullable(),
  })
  .strict();

export const organizationDeletionSummaryResponseSchema = z
  .object({ summary: organizationDeletionSummarySchema })
  .strict();

export const organizationDeletionResponseSchema = z
  .object({
    deletedOrganizationId: idSchema,
    nextOrganizationId: idSchema.nullable(),
  })
  .strict();

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
export type OrganizationDeleteInput = z.infer<typeof organizationDeleteSchema>;
export type OrganizationDeletionSummary = z.infer<typeof organizationDeletionSummarySchema>;
export type OrganizationDeletionSummaryResponse = z.infer<
  typeof organizationDeletionSummaryResponseSchema
>;
export type OrganizationDeletionResponse = z.infer<typeof organizationDeletionResponseSchema>;
export type InviteCreateInput = z.infer<typeof inviteCreateSchema>;
