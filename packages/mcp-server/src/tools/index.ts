import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpIdentity, Principal } from '@orbit/shared/policy';
import { registerAdminTools } from './admin.ts';
import { registerAnalyticsTools } from './analytics.ts';
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

export function registerTools(
  server: McpServer,
  principal: Principal,
  identity: McpIdentity,
  appUrl: string,
): void {
  registerAnalyticsTools(server, principal);
  registerIdentityTools(server, principal, identity);
  registerInboxTools(server, principal, appUrl);
  registerIssueTools(server, principal, appUrl, identity);
  registerPlanningTools(server, principal, appUrl);
  registerScrumTools(server, principal);
  registerAdminTools(server, principal);
  registerDocTools(server, principal, appUrl);
  registerGithubTools(server, principal, appUrl);
  registerWorkspaceTools(server, principal, appUrl);
  registerTaxonomyTools(server, principal);
  registerOrgTools(server, principal);
}
