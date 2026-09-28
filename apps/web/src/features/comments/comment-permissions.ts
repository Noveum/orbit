import type { OrgRole } from '@orbit/shared/constants';
import { permissionsFor } from '@orbit/shared/policy';

export function canModerateComments(role: OrgRole): boolean {
  return permissionsFor(role).includes('comment:delete:any');
}
