import { forbidden } from '../errors/index.ts';

export function assertHumanIssueWriter(actorType: 'user' | 'agent'): void {
  if (actorType === 'agent') {
    throw forbidden('Agent issue writes are unavailable in this release.');
  }
}
