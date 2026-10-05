import { z } from 'zod';

export const agentConsentSelectionSchema = z.union([
  z.strictObject({ identityId: z.string().min(1) }),
  z.strictObject({ name: z.string().trim().min(1).max(100) }),
]);
export type AgentConsentSelection = z.infer<typeof agentConsentSelectionSchema>;

export const mcpConsentDecisionSchema = z.object({
  decision: z.enum(['allow', 'deny']),
  consentCode: z.string().min(1),
  organizationId: z.string().min(1),
  clientId: z.string().min(1).optional(),
  scope: z.string().optional(),
  agent: agentConsentSelectionSchema.optional(),
});
