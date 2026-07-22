import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Principal } from '@orbit/shared/policy';
import { registerAdminTools } from './admin.ts';
import { registerIdentityTools } from './identity.ts';
import { registerIssueTools } from './issues.ts';
import { registerPlanningTools } from './planning.ts';

export function registerTools(server: McpServer, principal: Principal): void {
  registerIdentityTools(server, principal);
  registerIssueTools(server, principal);
  registerPlanningTools(server, principal);
  registerAdminTools(server, principal);
}
