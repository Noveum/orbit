import { z } from 'zod';

export const agentConsentSelectionSchema = z.union([
  z.strictObject({ identityId: z.string().min(1), write: z.boolean().default(false) }),
  z.strictObject({ name: z.string().trim().min(1).max(100), write: z.boolean().default(false) }),
]);
export type AgentConsentSelection = z.input<typeof agentConsentSelectionSchema>;

export const mcpConsentDecisionSchema = z.object({
  decision: z.enum(['allow', 'deny']),
  consentCode: z.string().min(1),
  organizationId: z.string().min(1),
  clientId: z.string().min(1).optional(),
  scope: z.string().optional(),
  agent: agentConsentSelectionSchema.optional(),
});
