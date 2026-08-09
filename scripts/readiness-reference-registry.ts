import registryData from './readiness-reference-registry.json';

export const IMPLEMENTATION_BASELINE_COMMIT = '808d7148478889437f42369a54e0553924352eaa';

export type MaintainerRole =
  | 'Security maintainer'
  | 'Data maintainer'
  | 'Platform maintainer'
  | 'Realtime maintainer'
  | 'Integrations maintainer'
  | 'Release maintainer'
  | 'Documentation maintainer'
  | 'Repository maintainer';

export type EvidenceKind =
  | 'audit-risk'
  | 'risk'
  | 'implementation'
  | 'failing-test'
  | 'test'
  | 'gate'
  | 'docs'
  | 'decision'
  | 'closure'
  | 'mitigation'
  | 'non-behavioral'
  | 'justification';

export interface CandidateIdentity {
  readonly kind: 'git-commit';
  readonly commitSha: string;
  readonly commitUrl: string;
}

export interface PullRequestIdentity {
  readonly kind: 'github-pull-request';
  readonly number: number;
  readonly url: string;
}

interface LinkedEvidenceRecord {
  readonly url: string;
}

export interface AuditRiskEvidenceRecord extends LinkedEvidenceRecord {
  readonly kind: 'audit-risk';
  readonly sourceCommit: string;
}

export interface RiskEvidenceRecord extends LinkedEvidenceRecord {
  readonly kind: 'risk';
}

export interface ImplementationEvidenceRecord extends LinkedEvidenceRecord {
  readonly kind: 'implementation';
  readonly observedAt: string;
  readonly commit: CandidateIdentity;
  readonly pullRequest: PullRequestIdentity;
}

export interface FailingTestEvidenceRecord extends LinkedEvidenceRecord {
  readonly kind: 'failing-test';
  readonly observedAt: string;
  readonly commit: CandidateIdentity;
  readonly pullRequest: PullRequestIdentity;
  readonly artifactDigest: string;
}

interface CandidateEvidenceBase extends LinkedEvidenceRecord {
  readonly observedAt: string;
  readonly candidate: CandidateIdentity;
}

export interface WorkflowEvidenceRecord extends CandidateEvidenceBase {
  readonly kind: 'test' | 'gate';
  readonly artifactDigest: string;
}

export interface CandidateAttestationRecord extends CandidateEvidenceBase {
  readonly kind: 'decision' | 'non-behavioral';
}

export interface ClosureEvidenceRecord extends LinkedEvidenceRecord {
  readonly kind: 'closure';
  readonly findingId: string;
  readonly observedAt: string;
  readonly candidate: CandidateIdentity;
  readonly evidenceCommit: CandidateIdentity;
  readonly evidenceDigest: string;
}

export type CandidateEvidenceRecord = WorkflowEvidenceRecord | CandidateAttestationRecord;

export interface SupportingEvidenceRecord extends LinkedEvidenceRecord {
  readonly kind: 'docs' | 'mitigation' | 'justification';
}

export type EvidenceRecord =
  | AuditRiskEvidenceRecord
  | RiskEvidenceRecord
  | ImplementationEvidenceRecord
  | FailingTestEvidenceRecord
  | CandidateEvidenceRecord
  | ClosureEvidenceRecord
  | SupportingEvidenceRecord;

export interface RoleAliasPrincipal {
  readonly kind: 'role-alias';
  readonly role: MaintainerRole;
  readonly assignmentUrl: string;
}

export interface HumanPrincipal {
  readonly kind: 'human';
  readonly role: MaintainerRole;
  readonly subjectId: string;
  readonly assignmentUrl: string;
}

export interface HumanAliasPrincipal {
  readonly kind: 'human-alias';
  readonly role: MaintainerRole;
  readonly canonicalPrincipal: string;
  readonly assignmentUrl: string;
}

export type AuthoredPrincipalRecord = RoleAliasPrincipal | HumanPrincipal | HumanAliasPrincipal;
export type PrincipalRecord = RoleAliasPrincipal | HumanPrincipal;

export interface ReadinessReferenceRegistrySource {
  readonly recordEntries: ReadonlyArray<readonly [string, EvidenceRecord]>;
  readonly principalEntries: ReadonlyArray<readonly [string, AuthoredPrincipalRecord]>;
}

export interface ReadinessReferenceRegistry {
  readonly records: ReadonlyMap<string, EvidenceRecord>;
  readonly principals: ReadonlyMap<string, PrincipalRecord>;
}

export type ReadinessReferenceRegistryBuild =
  | { readonly errors: readonly string[] }
  | { readonly errors: readonly []; readonly registry: ReadinessReferenceRegistry };

const MAINTAINER_ROLES = new Set<MaintainerRole>([
  'Security maintainer',
  'Data maintainer',
  'Platform maintainer',
  'Realtime maintainer',
  'Integrations maintainer',
  'Release maintainer',
  'Documentation maintainer',
  'Repository maintainer',
]);
const EVIDENCE_KINDS = new Set<EvidenceKind>([
  'audit-risk',
  'risk',
  'implementation',
  'failing-test',
  'test',
  'gate',
  'docs',
  'decision',
  'closure',
  'mitigation',
  'non-behavioral',
  'justification',
]);
const RECORD_KEY = /^record:[a-z][a-z0-9-]*\/[a-z0-9][a-z0-9._/-]*$/;
const PRINCIPAL_KEY = /^principal:[a-z0-9][a-z0-9._/-]*$/;
const SUBJECT_ID = /^subject:[a-z0-9][a-z0-9._/-]*$/;
const FINDING_ID = /^[A-Z][A-Z0-9]*-\d{3}$/;
const FULL_COMMIT = /^[a-f0-9]{40}$/;

function objectValue(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function validHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function validEvidenceKind(value: unknown): value is EvidenceKind {
  return typeof value === 'string' && EVIDENCE_KINDS.has(value as EvidenceKind);
}

function validRole(value: unknown): value is MaintainerRole {
  return typeof value === 'string' && MAINTAINER_ROLES.has(value as MaintainerRole);
}

function namespaceMatches(key: string, kind: EvidenceKind): boolean {
  const namespace = /^record:([^/]+)\//.exec(key)?.[1];
  return namespace === (kind === 'audit-risk' ? 'audit' : kind);
}

function candidateErrors(record: Readonly<Record<string, unknown>>, label: string): string[] {
  const errors: string[] = [];
  if ('releaseCommit' in record) errors.push(`${label} has contradictory candidate metadata.`);
  const candidate = objectValue(record['candidate']);
  const commitSha = candidate?.['commitSha'];
  if (candidate?.['kind'] !== 'git-commit' || typeof commitSha !== 'string')
    return [...errors, `${label} has an invalid candidate commit.`];
  if (!FULL_COMMIT.test(commitSha)) return [...errors, `${label} has an invalid candidate commit.`];
  if (commitSha === IMPLEMENTATION_BASELINE_COMMIT)
    errors.push(`${label} uses the implementation baseline as a release candidate.`);
  const expectedCommitUrl = `https://github.com/Noveum/orbit/commit/${commitSha}`;
  if (candidate['commitUrl'] !== expectedCommitUrl)
    errors.push(`${label} has candidate URL metadata mismatch.`);
  if (typeof record['url'] === 'string') {
    try {
      const evidenceUrl = new URL(record['url']);
      if (
        evidenceUrl.hostname.toLowerCase() === 'github.com' &&
        evidenceUrl.pathname.toLowerCase().startsWith('/noveum/orbit/commit') &&
        record['url'] !== expectedCommitUrl
      )
        errors.push(`${label} has evidence URL candidate mismatch.`);
    } catch {
      errors.push(`${label} has invalid evidence link.`);
    }
  }
  return errors;
}

function immutableCommitErrors(value: unknown, label: string): string[] {
  const commit = objectValue(value);
  const commitSha = commit?.['commitSha'];
  if (
    commit?.['kind'] !== 'git-commit' ||
    typeof commitSha !== 'string' ||
    !FULL_COMMIT.test(commitSha) ||
    commit['commitUrl'] !== `https://github.com/Noveum/orbit/commit/${commitSha}`
  )
    return [`${label} has an invalid immutable commit identity.`];
  return [];
}

function pullRequestIdentityErrors(value: unknown, label: string): string[] {
  const pullRequest = objectValue(value);
  const number = pullRequest?.['number'];
  if (
    pullRequest?.['kind'] !== 'github-pull-request' ||
    typeof number !== 'number' ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    pullRequest['url'] !== `https://github.com/Noveum/orbit/pull/${number}`
  )
    return [`${label} has invalid pull request identity.`];
  return [];
}

function immutableCiErrors(record: Readonly<Record<string, unknown>>, label: string): string[] {
  if (
    /^https:\/\/github\.com\/Noveum\/orbit\/actions\/runs\/[1-9]\d*\/attempts\/[1-9]\d*$/.test(
      String(record['url']),
    ) &&
    /^sha256:[a-f0-9]{64}$/.test(String(record['artifactDigest']))
  )
    return [];
  return [`${label} has invalid immutable CI evidence.`];
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Registry entries keep structural evidence rules in one contract.
function recordEntryErrors(
  entry: readonly [string, unknown],
  index: number,
  seen: Set<string>,
): string[] {
  const [key, value] = entry;
  const label = `Registry record entry ${index + 1}`;
  const errors: string[] = [];
  if (!RECORD_KEY.test(key)) errors.push(`${label} has an invalid key.`);
  if (seen.has(key)) errors.push(`${label} duplicates an earlier key.`);
  seen.add(key);
  const record = objectValue(value);
  if (record === undefined) return [...errors, `${label} has an invalid evidence record.`];
  const kind = record['kind'];
  if (!validEvidenceKind(kind)) return [...errors, `${label} has an invalid evidence kind.`];
  if (RECORD_KEY.test(key) && !namespaceMatches(key, kind))
    errors.push(`${label} has a namespace that does not match its evidence kind.`);
  if (!validHttpsUrl(record['url'])) errors.push(`${label} has an invalid evidence link.`);
  if (kind === 'audit-risk') {
    const sourceCommit = record['sourceCommit'];
    if (
      typeof sourceCommit !== 'string' ||
      !FULL_COMMIT.test(sourceCommit) ||
      record['url'] !== `https://github.com/Noveum/orbit/commit/${sourceCommit}`
    )
      errors.push(`${label} has an invalid audit source identity.`);
  }
  if (
    [
      'implementation',
      'failing-test',
      'test',
      'gate',
      'decision',
      'closure',
      'non-behavioral',
    ].includes(kind) &&
    !validTimestamp(record['observedAt'])
  )
    errors.push(`${label} has an invalid evidence timestamp.`);
  if (kind === 'implementation' || kind === 'failing-test') {
    errors.push(...immutableCommitErrors(record['commit'], label));
    errors.push(...pullRequestIdentityErrors(record['pullRequest'], label));
  }
  if (kind === 'implementation') {
    const pullRequest = objectValue(record['pullRequest']);
    if (typeof pullRequest?.['url'] === 'string' && record['url'] !== pullRequest['url'])
      errors.push(`${label} has implementation link mismatch.`);
  }
  if (['test', 'gate', 'decision', 'non-behavioral'].includes(kind))
    errors.push(...candidateErrors(record, label));
  if (kind === 'closure') {
    const candidate = objectValue(record['candidate']);
    const candidateCommit = candidate?.['commitSha'];
    errors.push(...immutableCommitErrors(candidate, label));
    errors.push(...immutableCommitErrors(record['evidenceCommit'], label));
    if (candidateCommit === IMPLEMENTATION_BASELINE_COMMIT)
      errors.push(`${label} uses the implementation baseline as a release candidate.`);
    const evidenceCommit = objectValue(record['evidenceCommit']);
    if (
      !(
        FINDING_ID.test(String(record['findingId'])) &&
        /^sha256:[a-f0-9]{64}$/.test(String(record['evidenceDigest']))
      ) ||
      record['url'] !== evidenceCommit?.['commitUrl']
    )
      errors.push(`${label} has invalid durable closure evidence.`);
  }
  if (kind === 'failing-test' || kind === 'test' || kind === 'gate')
    errors.push(...immutableCiErrors(record, label));
  return errors;
}

interface IndexedPrincipal {
  readonly index: number;
  readonly key: string;
  readonly value: AuthoredPrincipalRecord;
}

function principalEntryErrors(
  entry: readonly [string, unknown],
  index: number,
  seenKeys: Set<string>,
  seenSubjects: Set<string>,
): { readonly errors: string[]; readonly principal?: IndexedPrincipal } {
  const [key, value] = entry;
  const label = `Registry principal entry ${index + 1}`;
  const errors: string[] = [];
  if (!PRINCIPAL_KEY.test(key)) errors.push(`${label} has an invalid key.`);
  if (seenKeys.has(key)) errors.push(`${label} duplicates an earlier key.`);
  seenKeys.add(key);
  const principal = objectValue(value);
  if (principal === undefined)
    return { errors: [...errors, `${label} has an invalid principal record.`] };
  const kind = principal['kind'];
  if (!['role-alias', 'human', 'human-alias'].includes(String(kind)))
    return { errors: [...errors, `${label} has an invalid principal kind.`] };
  if (!validRole(principal['role'])) errors.push(`${label} has an invalid role.`);
  if (!validHttpsUrl(principal['assignmentUrl']))
    errors.push(`${label} has an invalid assignment link.`);
  if (kind === 'human') {
    const subjectId = principal['subjectId'];
    if (typeof subjectId !== 'string' || !SUBJECT_ID.test(subjectId))
      errors.push(`${label} has an invalid subject identity.`);
    else if (seenSubjects.has(subjectId)) errors.push(`${label} duplicates a canonical subject.`);
    else seenSubjects.add(subjectId);
  }
  if (
    kind === 'human-alias' &&
    (typeof principal['canonicalPrincipal'] !== 'string' ||
      !PRINCIPAL_KEY.test(principal['canonicalPrincipal']))
  )
    errors.push(`${label} has an invalid canonical human assignment.`);
  if (errors.length > 0) return { errors };
  return {
    errors,
    principal: { index, key, value: principal as unknown as AuthoredPrincipalRecord },
  };
}

function aliasErrors(principals: readonly IndexedPrincipal[]): string[] {
  const errors: string[] = [];
  for (const principal of principals) {
    const alias = principal.value;
    if (alias.kind !== 'human-alias') continue;
    const label = `Registry principal entry ${principal.index + 1}`;
    const canonical = principals.find((candidate) => candidate.key === alias.canonicalPrincipal);
    if (canonical?.value.kind !== 'human') {
      errors.push(`${label} has an invalid canonical human assignment.`);
      continue;
    }
    if (canonical.value.role !== alias.role)
      errors.push(`${label} conflicts with its canonical human assignment.`);
  }
  return errors;
}

export function buildReadinessReferenceRegistry(
  source: ReadinessReferenceRegistrySource,
): ReadinessReferenceRegistryBuild {
  const recordKeySet = new Set<string>();
  const principalKeySet = new Set<string>();
  const subjectSet = new Set<string>();
  const recordErrors = source.recordEntries.flatMap((entry, index) =>
    recordEntryErrors(entry, index, recordKeySet),
  );
  const principalResults = source.principalEntries.map((entry, index) =>
    principalEntryErrors(entry, index, principalKeySet, subjectSet),
  );
  const principals = principalResults.flatMap((result) =>
    result.principal === undefined ? [] : [result.principal],
  );
  const errors = [
    ...recordErrors,
    ...principalResults.flatMap((result) => result.errors),
    ...aliasErrors(principals),
  ];
  if (errors.length > 0) return { errors };
  const records = new Map(
    source.recordEntries.map(([key, value]) => [key, value as EvidenceRecord] as const),
  );
  const principalMap = new Map<string, PrincipalRecord>();
  for (const principal of principals) {
    const alias = principal.value;
    if (alias.kind !== 'human-alias') {
      principalMap.set(principal.key, alias);
      continue;
    }
    const canonical = principals.find((candidate) => candidate.key === alias.canonicalPrincipal);
    if (canonical?.value.kind !== 'human') continue;
    principalMap.set(principal.key, {
      kind: 'human',
      role: alias.role,
      subjectId: canonical.value.subjectId,
      assignmentUrl: alias.assignmentUrl,
    });
  }
  return { errors: [], registry: { records, principals: principalMap } };
}

export const readinessReferenceRegistrySource =
  registryData as unknown as ReadinessReferenceRegistrySource;
