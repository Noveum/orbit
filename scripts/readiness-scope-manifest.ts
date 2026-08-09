import { createHash } from 'node:crypto';
import manifestData from './readiness-scope-manifest.json';

export type ReadinessPriority = 'P0' | 'P1';

export interface AuditedScopeFinding {
  readonly id: string;
  readonly priority: ReadinessPriority;
  readonly findingHash: string;
  readonly requiredOutcomeHash: string;
}

export interface ReadinessScopeManifest {
  readonly version: string;
  readonly digest: string;
  readonly findings: readonly AuditedScopeFinding[];
}

export function computeReadinessTextDigest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function computeReadinessScopeDigest(
  version: string,
  findings: readonly AuditedScopeFinding[],
): string {
  const canonical = JSON.stringify({
    schema: 'readiness-scope/v2',
    version,
    findings: [...findings].sort((left, right) => left.id.localeCompare(right.id)),
  });
  return computeReadinessTextDigest(canonical);
}

export const readinessScopeManifest = manifestData as ReadinessScopeManifest;
