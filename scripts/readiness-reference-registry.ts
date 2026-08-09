export const SELECTED_RELEASE_COMMIT = '808d714';

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
  | 'test'
  | 'gate'
  | 'docs'
  | 'decision'
  | 'mitigation'
  | 'non-behavioral'
  | 'justification';

export interface EvidenceRecord {
  readonly kind: EvidenceKind;
  readonly url: string;
  readonly releaseCommit?: string;
}

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

export type PrincipalRecord = RoleAliasPrincipal | HumanPrincipal;

export interface ReadinessReferenceRegistry {
  readonly records: ReadonlyMap<string, EvidenceRecord>;
  readonly principals: ReadonlyMap<string, PrincipalRecord>;
}

export const readinessReferenceRegistry: ReadinessReferenceRegistry = {
  records: new Map([
    [
      'record:audit/f1bfdc3',
      {
        kind: 'audit-risk',
        url: 'https://github.com/Noveum/orbit/commit/f1bfdc3',
        releaseCommit: 'f1bfdc3',
      },
    ],
    [
      'record:audit/9f961a1',
      {
        kind: 'audit-risk',
        url: 'https://github.com/Noveum/orbit/commit/9f961a1',
        releaseCommit: '9f961a1',
      },
    ],
  ]),
  principals: new Map([
    [
      'principal:security-owner',
      {
        kind: 'role-alias',
        assignmentUrl:
          'https://github.com/Noveum/orbit/blob/main/docs/maintainers/readiness-ledger.md',
        role: 'Security maintainer',
      },
    ],
    [
      'principal:data-owner',
      {
        kind: 'role-alias',
        assignmentUrl:
          'https://github.com/Noveum/orbit/blob/main/docs/maintainers/readiness-ledger.md',
        role: 'Data maintainer',
      },
    ],
    [
      'principal:platform-owner',
      {
        kind: 'role-alias',
        assignmentUrl:
          'https://github.com/Noveum/orbit/blob/main/docs/maintainers/readiness-ledger.md',
        role: 'Platform maintainer',
      },
    ],
    [
      'principal:realtime-owner',
      {
        kind: 'role-alias',
        assignmentUrl:
          'https://github.com/Noveum/orbit/blob/main/docs/maintainers/readiness-ledger.md',
        role: 'Realtime maintainer',
      },
    ],
    [
      'principal:integrations-owner',
      {
        kind: 'role-alias',
        assignmentUrl:
          'https://github.com/Noveum/orbit/blob/main/docs/maintainers/readiness-ledger.md',
        role: 'Integrations maintainer',
      },
    ],
    [
      'principal:release-owner',
      {
        kind: 'role-alias',
        assignmentUrl:
          'https://github.com/Noveum/orbit/blob/main/docs/maintainers/readiness-ledger.md',
        role: 'Release maintainer',
      },
    ],
    [
      'principal:documentation-owner',
      {
        kind: 'role-alias',
        assignmentUrl:
          'https://github.com/Noveum/orbit/blob/main/docs/maintainers/readiness-ledger.md',
        role: 'Documentation maintainer',
      },
    ],
    [
      'principal:repository-owner',
      {
        kind: 'role-alias',
        assignmentUrl:
          'https://github.com/Noveum/orbit/blob/main/docs/maintainers/readiness-ledger.md',
        role: 'Repository maintainer',
      },
    ],
  ]),
};
