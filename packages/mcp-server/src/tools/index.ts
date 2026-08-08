import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Principal } from '@orbit/shared/policy';
import { registerAdminTools } from './admin.ts';
import { registerDocTools } from './docs.ts';
import { registerGithubTools } from './github.ts';
import { registerIdentityTools } from './identity.ts';
import { registerInboxTools } from './inbox.ts';
import { registerIssueTools } from './issues.ts';
import { registerOrgTools } from './org.ts';
import { registerPlanningTools } from './planning.ts';
import { registerScrumTools } from './scrum.ts';
import { registerTaxonomyTools } from './taxonomy.ts';
import { registerWorkspaceTools } from './workspace.ts';

export function registerTools(server: McpServer, principal: Principal): void {
  registerIdentityTools(server, principal);
  registerInboxTools(server, principal);
  registerIssueTools(server, principal);
  registerPlanningTools(server, principal);
  registerScrumTools(server, principal);
  registerAdminTools(server, principal);
  registerDocTools(server, principal);
  registerGithubTools(server, principal);
  registerWorkspaceTools(server, principal);
  registerTaxonomyTools(server, principal);
  registerOrgTools(server, principal);
}
