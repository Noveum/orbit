import { integrationSettingsProviderSchema } from '@orbit/shared/validators';

export type IntegrationProvider = 'github' | 'slack' | 'mcp';

export function integrationProvider(
  requested: unknown,
  canManage: boolean,
  hasSlack: boolean,
): IntegrationProvider {
  const provider = integrationSettingsProviderSchema.catch('github').parse(requested);
  if (!canManage || provider === 'mcp') return 'mcp';
  if (provider === 'slack' && hasSlack) return 'slack';
  return 'github';
}
