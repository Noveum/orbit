export type IntegrationProvider = 'github' | 'slack' | 'mcp';

export function integrationProvider(
  requested: unknown,
  canManage: boolean,
  hasSlack: boolean,
): IntegrationProvider {
  if (!canManage || requested === 'mcp') return 'mcp';
  if (requested === 'slack' && hasSlack) return 'slack';
  return 'github';
}
