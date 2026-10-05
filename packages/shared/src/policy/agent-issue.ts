import { forbidden } from '../errors/index.ts';
import { assertCan, type Permission, type Principal } from './index.ts';

export function assertAgentIssueWrite(
  principal: Principal,
  scopes: string,
  permission: Permission,
): void {
  if (!scopes.split(/\s+/).includes('orbit.write')) {
    throw forbidden('This Agent connection does not hold the Issue write scope.');
  }
  assertCan(principal, permission);
}
