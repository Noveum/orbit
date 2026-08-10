import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  parseExceptionRows,
  parseFindingRows,
  parsePlanFindings,
} from '../../../scripts/check-readiness-ledger.ts';
import {
  parseRawGitDiff,
  type ReadinessScopePrInput,
  readyEvidenceForRegistry,
  validateFinalReadinessScopeState,
  validateReadinessScopePullRequest,
} from '../../../scripts/check-readiness-scope-pr.ts';
import {
  computeReadinessScopeDigest,
  computeReadinessTextDigest,
  type ReadinessScopeManifest,
} from '../../../scripts/readiness-scope-manifest.ts';
import {
  githubWorkflowAttemptSchema,
  pullRequestTargetEventSchema,
  readinessScopePrInputSchema,
} from '../../shared/src/validators/readiness.ts';

const baseSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const headSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const allowedFiles = [
  'docs/maintainers/readiness-ledger.md',
  'docs/maintainers/readiness-scope-audit.json',
  'docs/superpowers/plans/2026-08-09-open-source-readiness.md',
  'scripts/readiness-scope-manifest.json',
] as const;

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function closureRegistry(evidenceCommit = baseSha): string {
  const candidateCommit = 'cccccccccccccccccccccccccccccccccccccccc';
  return canonicalJson({
    recordEntries: [
      [
        'record:closure/doc-001',
        {
          kind: 'closure',
          findingId: 'DOC-001',
          observedAt: '2026-08-09T11:00:00.000Z',
          candidate: {
            kind: 'git-commit',
            commitSha: candidateCommit,
            commitUrl: `https://github.com/Noveum/orbit/commit/${candidateCommit}`,
          },
          evidenceCommit: {
            kind: 'git-commit',
            commitSha: evidenceCommit,
            commitUrl: `https://github.com/Noveum/orbit/commit/${evidenceCommit}`,
          },
          evidenceDigest: `sha256:${'1'.repeat(64)}`,
          url: `https://github.com/Noveum/orbit/commit/${evidenceCommit}`,
        },
      ],
    ],
    principalEntries: [],
  });
}

function readyEvidence(evidenceCommit = baseSha, baseContainsEvidence = true) {
  const pullRequestBaseSha = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  const pullRequestHeadSha = 'dddddddddddddddddddddddddddddddddddddddd';
  return {
    findingId: 'DOC-001',
    evidenceCommit,
    baseContainsEvidence,
    pullRequestNumber: 123,
    pullRequestBaseRef: 'main',
    pullRequestBaseSha,
    pullRequestBaseRepository: 'Noveum/orbit',
    pullRequestHeadSha,
    mergeCommitSha: evidenceCommit,
    mergedAt: '2026-08-09T10:00:00.000Z',
    statusState: 'success' as const,
    statusContext: 'Trusted readiness policy',
    statusCreator: 'github-actions[bot]',
    statusTargetUrl: 'https://github.com/Noveum/orbit/actions/runs/2000/attempts/1',
    statusCreatedAt: '2026-08-09T09:30:00.000Z',
    statusUpdatedAt: '2026-08-09T09:31:00.000Z',
    configuredWorkflowId: 456,
    runWorkflowId: 456,
    runWorkflowPath: '.github/workflows/readiness-scope.yml',
    runWorkflowState: 'active' as const,
    runWorkflowDefinitionDigest:
      'sha256:bbe370f0610b279ad230dc22a6a4819ab9380e7ca88fa4e10bd75785406c24be',
    runRepository: 'Noveum/orbit',
    runId: 2000,
    runAttempt: 1,
    runEvent: 'pull_request_target',
    runConclusion: 'success',
    runHeadSha: pullRequestHeadSha,
    definitionCommitSha: pullRequestBaseSha,
    definitionCommitIsEvidenceAncestor: true,
    runStartedAt: '2026-08-09T09:00:00.000Z',
    runUpdatedAt: '2026-08-09T09:32:00.000Z',
    runPullRequests: [
      {
        number: 123,
        headSha: pullRequestHeadSha,
        baseRef: 'main',
        baseSha: pullRequestBaseSha,
      },
    ],
  };
}

function plan(finding: string, outcome: string): string {
  return `
## Findings register

| ID | Priority | Finding | Verified evidence | Required outcome |
| --- | --- | --- | --- | --- |
| DOC-001 | P1 | ${finding} | Audit | ${outcome} |
`;
}

function ledger(finding: string, outcome: string, status = 'Open'): string {
  return `
## Readiness findings register

| ID | Priority | Finding | Accountable owner role | Accountable owner reference | Security authority required | Status | Implementation evidence | Change evidence | Release-gate evidence | Documentation evidence | Objective close condition | Residual-risk record | Decision record | Independent Release approver | Security authority record |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DOC-001 | P1 | ${finding} | Documentation maintainer | principal:documentation-owner | No | ${status} | pending:open | pending:open | pending:open | pending:open | ${outcome} | risk:record:audit/doc-001 | pending:open | pending:open | not-required |

## P1 exception register

| Finding ID | Accountable owner reference | Expiry date | Mitigation evidence | Public limitation | Residual-risk record | Decision record | Independent Release approver | Security authority record |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
`;
}

function stagedExceptionLedger(status: 'Accepted P1 exception' | 'Ready for closure'): string {
  const staged = ledger('Original risk', 'Original outcome', status).replace(
    `| ${status} | pending:open | pending:open | pending:open | pending:open | Original outcome | risk:record:audit/doc-001 | pending:open | pending:open | not-required |`,
    `| ${status} | implementation:record:implementation/doc-001 | test-na:record:non-behavioral/doc-001;justification=record:justification/doc-001;approver=principal:release-owner | gate:record:gate/doc-001 | docs:record:docs/doc-001 | Original outcome | risk:record:audit/doc-001 | decision:record:decision/doc-001;implementation=principal:implementation-owner;finding=principal:documentation-owner;approver=principal:release-owner | approver:principal:release-owner | not-required |`,
  );
  const exception =
    '| DOC-001 | principal:documentation-owner | 2026-12-01 | mitigation:record:mitigation/doc-001 | Self-hosted users cannot import legacy archives during migration. | risk:record:audit/doc-001 | decision:record:decision/doc-001;implementation=principal:implementation-owner;finding=principal:documentation-owner;approver=principal:release-owner | approver:principal:release-owner | not-required |';
  return staged.replace(/\n$/, `\n${exception}\n`);
}

function stagedClosedLedger(status: 'Closed' | 'Ready for closure'): string {
  return ledger('Original risk', 'Original outcome', status).replace(
    `| ${status} | pending:open | pending:open | pending:open | pending:open | Original outcome | risk:record:audit/doc-001 | pending:open | pending:open | not-required |`,
    `| ${status} | implementation:record:implementation/doc-001 | test-na:record:non-behavioral/doc-001;justification=record:justification/doc-001;approver=principal:release-owner | gate:record:gate/doc-001 | docs:record:docs/doc-001 | Original outcome | risk:record:audit/doc-001 | decision:record:decision/doc-001;implementation=principal:implementation-owner;finding=principal:documentation-owner;approver=principal:release-owner | approver:principal:release-owner | not-required |`,
  );
}

function manifest(version: string, finding: string, outcome: string): string {
  const findings = [
    {
      id: 'DOC-001',
      priority: 'P1' as const,
      findingHash: computeReadinessTextDigest(finding),
      requiredOutcomeHash: computeReadinessTextDigest(outcome),
    },
  ];
  return canonicalJson({
    version,
    digest: computeReadinessScopeDigest(version, findings),
    findings,
  });
}

function fixture(): ReadinessScopePrInput {
  const baseVersion = 'readiness-scope/2026-08-09-v1';
  const headVersion = 'readiness-scope/2026-08-09-v2';
  const baseManifest = manifest(baseVersion, 'Original risk', 'Original outcome');
  const headManifest = manifest(headVersion, 'Canonical risk', 'Canonical outcome');
  const baseDigest = JSON.parse(baseManifest).digest as string;
  const headDigest = JSON.parse(headManifest).digest as string;
  return {
    baseRef: 'main',
    baseSha,
    headSha,
    changedFiles: [...allowedFiles],
    base: {
      plan: plan('Original risk', 'Original outcome'),
      ledger: ledger('Original risk', 'Original outcome'),
      manifest: baseManifest,
      audit: canonicalJson({}),
      registry: canonicalJson({ recordEntries: [], principalEntries: [] }),
    },
    head: {
      plan: plan('Canonical risk', 'Canonical outcome'),
      ledger: ledger('Canonical risk', 'Canonical outcome'),
      manifest: headManifest,
      audit: canonicalJson({
        schemaVersion: 1,
        kind: 'scope-change',
        baseVersion,
        headVersion,
        baseDigest,
        headDigest,
        reviewUrl: 'https://github.com/Noveum/orbit/pull/123',
        changedFindingIds: ['DOC-001'],
        noRiskDisappears: true,
        rationale: 'The canonical wording is strengthened and remains explicitly governed.',
      }),
      registry: canonicalJson({ recordEntries: [], principalEntries: [] }),
    },
    readyEvidence: [],
    reviews: [
      {
        login: 'imshashank',
        state: 'APPROVED',
        commitId: headSha,
        submittedAt: '2026-08-09T10:00:00.000Z',
      },
      {
        login: 'pulkitxm',
        state: 'APPROVED',
        commitId: headSha,
        submittedAt: '2026-08-09T10:01:00.000Z',
      },
    ],
  };
}

function withUnchangedFinding(input: ReadinessScopePrInput): ReadinessScopePrInput {
  const finding = 'Unchanged security risk';
  const outcome = 'Unchanged security outcome';
  const planRow = `| SEC-001 | P0 | ${finding} | Audit | ${outcome} |`;
  const ledgerRow = `| SEC-001 | P0 | ${finding} | Security maintainer | principal:security-owner | Yes | Open | pending:open | pending:open | pending:open | pending:open | ${outcome} | risk:record:audit/sec-001 | pending:open | pending:open | pending:open |`;
  const addPlanRow = (value: string) => value.replace(/\n$/, `\n${planRow}\n`);
  const addLedgerRow = (value: string) =>
    value.replace('\n\n## P1 exception register', `\n${ledgerRow}\n\n## P1 exception register`);
  const addManifestRow = (value: string) => {
    const parsed = JSON.parse(value) as ReadinessScopeManifest;
    const findings = [
      ...parsed.findings,
      {
        id: 'SEC-001',
        priority: 'P0' as const,
        findingHash: computeReadinessTextDigest(finding),
        requiredOutcomeHash: computeReadinessTextDigest(outcome),
      },
    ];
    return canonicalJson({
      version: parsed.version,
      digest: computeReadinessScopeDigest(parsed.version, findings),
      findings,
    });
  };
  const baseManifest = addManifestRow(input.base.manifest);
  const headManifest = addManifestRow(input.head.manifest);
  const audit = JSON.parse(input.head.audit) as Record<string, unknown>;
  return {
    ...input,
    base: {
      ...input.base,
      plan: addPlanRow(input.base.plan),
      ledger: addLedgerRow(input.base.ledger),
      manifest: baseManifest,
    },
    head: {
      ...input.head,
      plan: addPlanRow(input.head.plan),
      ledger: addLedgerRow(input.head.ledger),
      manifest: headManifest,
      audit: canonicalJson({
        ...audit,
        baseDigest: (JSON.parse(baseManifest) as ReadinessScopeManifest).digest,
        headDigest: (JSON.parse(headManifest) as ReadinessScopeManifest).digest,
      }),
    },
  };
}

function withUnchangedAcceptedP1Finding(input: ReadinessScopePrInput): ReadinessScopePrInput {
  const finding = 'Unchanged compatibility risk';
  const outcome = 'Unchanged compatibility outcome';
  const planRow = `| DOC-002 | P1 | ${finding} | Audit | ${outcome} |`;
  const ledgerRow = `| DOC-002 | P1 | ${finding} | Documentation maintainer | principal:documentation-owner | No | Accepted P1 exception | implementation:record:implementation/doc-002 | test-na:record:non-behavioral/doc-002;justification=record:justification/doc-002;approver=principal:release-owner | gate:record:gate/doc-002 | docs:record:docs/doc-002 | ${outcome} | risk:record:risk/doc-002 | decision:record:decision/doc-002;implementation=principal:implementation-owner;finding=principal:documentation-owner;approver=principal:release-owner | approver:principal:release-owner | not-required |`;
  const addPlanRow = (value: string) => value.replace(/\n$/, `\n${planRow}\n`);
  const addLedgerRow = (value: string) =>
    value.replace('\n\n## P1 exception register', `\n${ledgerRow}\n\n## P1 exception register`);
  const addManifestRow = (value: string) => {
    const parsed = JSON.parse(value) as ReadinessScopeManifest;
    const findings = [
      ...parsed.findings,
      {
        id: 'DOC-002',
        priority: 'P1' as const,
        findingHash: computeReadinessTextDigest(finding),
        requiredOutcomeHash: computeReadinessTextDigest(outcome),
      },
    ];
    return canonicalJson({
      version: parsed.version,
      digest: computeReadinessScopeDigest(parsed.version, findings),
      findings,
    });
  };
  const baseManifest = addManifestRow(input.base.manifest);
  const headManifest = addManifestRow(input.head.manifest);
  const audit = JSON.parse(input.head.audit) as Record<string, unknown>;
  return {
    ...input,
    base: {
      ...input.base,
      plan: addPlanRow(input.base.plan),
      ledger: addLedgerRow(input.base.ledger),
      manifest: baseManifest,
    },
    head: {
      ...input.head,
      plan: addPlanRow(input.head.plan),
      ledger: addLedgerRow(input.head.ledger),
      manifest: headManifest,
      audit: canonicalJson({
        ...audit,
        baseDigest: (JSON.parse(baseManifest) as ReadinessScopeManifest).digest,
        headDigest: (JSON.parse(headManifest) as ReadinessScopeManifest).digest,
      }),
    },
  };
}

describe('readiness scope pull request policy', () => {
  it('accepts a dedicated, audited, dual-approved exact-head scope change', () => {
    const input = fixture();
    for (const run of [
      () => parsePlanFindings(input.base.plan),
      () => parsePlanFindings(input.head.plan),
      () => parseFindingRows(input.base.ledger),
      () => parseFindingRows(input.head.ledger),
      () => parseExceptionRows(input.base.ledger),
      () => parseExceptionRows(input.head.ledger),
    ])
      expect(run).not.toThrow();
    expect(validateReadinessScopePullRequest(input)).toEqual([]);
  });

  it('allows a scope change to append only its newly referenced audit-risk records', () => {
    const input = fixture();
    const registry = canonicalJson({
      recordEntries: [
        [
          'record:audit/doc-001',
          {
            kind: 'audit-risk',
            url: `https://github.com/Noveum/orbit/commit/${baseSha}`,
            sourceCommit: baseSha,
          },
        ],
      ],
      principalEntries: [],
    });
    expect(
      validateReadinessScopePullRequest({
        ...input,
        changedFiles: [...allowedFiles, 'scripts/readiness-reference-registry.json'],
        head: { ...input.head, registry },
      }),
    ).toEqual([]);

    const unrelatedRegistry = canonicalJson({
      recordEntries: [
        [
          'record:audit/unrelated',
          {
            kind: 'audit-risk',
            url: `https://github.com/Noveum/orbit/commit/${baseSha}`,
            sourceCommit: baseSha,
          },
        ],
      ],
      principalEntries: [],
    });
    expect(
      validateReadinessScopePullRequest({
        ...input,
        changedFiles: [...allowedFiles, 'scripts/readiness-reference-registry.json'],
        head: { ...input.head, registry: unrelatedRegistry },
      }),
    ).toContain(
      'Scope-change registry additions must be audit-risk records reachable from changed findings.',
    );

    const riskRegistry = canonicalJson({
      recordEntries: [
        ['record:risk/doc-001', { kind: 'risk', url: 'https://example.test/risk/doc-001' }],
      ],
      principalEntries: [],
    });
    expect(
      validateReadinessScopePullRequest({
        ...input,
        changedFiles: [...allowedFiles, 'scripts/readiness-reference-registry.json'],
        head: {
          ...input.head,
          ledger: input.head.ledger.replace(
            'risk:record:audit/doc-001',
            'risk:record:risk/doc-001',
          ),
          registry: riskRegistry,
        },
      }),
    ).toContain(
      'Scope-change registry additions must be audit-risk records reachable from changed findings.',
    );

    const principalRegistry = canonicalJson({
      recordEntries: [],
      principalEntries: [
        [
          'principal:future-owner',
          {
            kind: 'human',
            role: 'Documentation maintainer',
            subjectId: 'subject:future-owner',
            assignmentUrl: 'https://example.test/assignment',
          },
        ],
      ],
    });
    expect(
      validateReadinessScopePullRequest({
        ...input,
        changedFiles: [...allowedFiles, 'scripts/readiness-reference-registry.json'],
        head: { ...input.head, registry: principalRegistry },
      }),
    ).toContain(
      'Scope-change registry additions must be audit-risk records reachable from changed findings.',
    );
  });

  it('allows ordinary pull requests when governed semantics do not change', () => {
    const input = fixture();
    expect(
      validateReadinessScopePullRequest({
        ...input,
        changedFiles: ['apps/web/src/app/page.tsx'],
        head: input.base,
        reviews: [],
      }),
    ).toEqual([]);
  });

  it('rejects registry evidence pre-staged in an ordinary product pull request', () => {
    const input = fixture();
    const registry = canonicalJson({
      recordEntries: [
        ['record:docs/prestage', { kind: 'docs', url: 'https://example.test/prestaged-evidence' }],
      ],
      principalEntries: [],
    });
    expect(
      validateReadinessScopePullRequest({
        ...input,
        changedFiles: ['apps/web/src/app/page.tsx', 'scripts/readiness-reference-registry.json'],
        base: input.base,
        head: { ...input.base, registry },
        reviews: [],
      }),
    ).toContain('Registry changes require an accounted ledger lifecycle transition.');
  });

  it('rejects registry-only evidence and authority changes', () => {
    const input = fixture();
    const registries = [
      canonicalJson({
        recordEntries: [
          ['record:docs/prestage', { kind: 'docs', url: 'https://example.test/docs' }],
        ],
        principalEntries: [],
      }),
      canonicalJson({
        recordEntries: [],
        principalEntries: [
          [
            'principal:future-owner',
            {
              kind: 'human',
              role: 'Documentation maintainer',
              subjectId: 'subject:future-owner',
              assignmentUrl: 'https://example.test/assignment',
            },
          ],
        ],
      }),
      canonicalJson({
        recordEntries: [],
        principalEntries: [
          [
            'principal:future-owner',
            {
              kind: 'human',
              role: 'Documentation maintainer',
              subjectId: 'subject:future-owner',
              assignmentUrl: 'https://example.test/assignment',
            },
          ],
          [
            'principal:future-alias',
            {
              kind: 'human-alias',
              role: 'Documentation maintainer',
              canonicalPrincipal: 'principal:future-owner',
              assignmentUrl: 'https://example.test/alias',
            },
          ],
        ],
      }),
    ];
    for (const registry of registries) {
      expect(
        validateReadinessScopePullRequest({
          ...input,
          changedFiles: ['scripts/readiness-reference-registry.json'],
          base: input.base,
          head: { ...input.base, registry },
          reviews: [],
        }),
      ).toContain('Registry changes require an accounted ledger lifecycle transition.');
    }
  });

  it('accepts registry evidence accounted for by a dedicated lifecycle transition', () => {
    const input = fixture();
    const registry = canonicalJson({
      recordEntries: [
        ['record:docs/doc-001', { kind: 'docs', url: 'https://example.test/docs/doc-001' }],
      ],
      principalEntries: [],
    });
    const ready = ledger('Original risk', 'Original outcome', 'Ready for closure').replace(
      '| pending:open | Original outcome |',
      '| docs:record:docs/doc-001 | Original outcome |',
    );
    expect(
      validateReadinessScopePullRequest({
        ...input,
        changedFiles: [
          'docs/maintainers/readiness-ledger.md',
          'scripts/readiness-reference-registry.json',
        ],
        base: input.base,
        head: { ...input.base, ledger: ready, registry },
        reviews: [],
      }),
    ).toEqual([]);
  });

  it('accounts for the canonical principal behind a referenced human alias', () => {
    const input = fixture();
    const registry = canonicalJson({
      recordEntries: [],
      principalEntries: [
        [
          'principal:future-owner',
          {
            kind: 'human',
            role: 'Documentation maintainer',
            subjectId: 'subject:future-owner',
            assignmentUrl: 'https://example.test/assignment',
          },
        ],
        [
          'principal:future-alias',
          {
            kind: 'human-alias',
            role: 'Documentation maintainer',
            canonicalPrincipal: 'principal:future-owner',
            assignmentUrl: 'https://example.test/alias',
          },
        ],
      ],
    });
    const ready = ledger('Original risk', 'Original outcome', 'Ready for closure').replace(
      'principal:documentation-owner',
      'principal:future-alias',
    );
    expect(
      validateReadinessScopePullRequest({
        ...input,
        changedFiles: [
          'docs/maintainers/readiness-ledger.md',
          'scripts/readiness-reference-registry.json',
        ],
        base: input.base,
        head: { ...input.base, ledger: ready, registry },
        reviews: [],
      }),
    ).toEqual([]);
  });

  it('rejects replacement of referenced registry evidence during a lifecycle transition', () => {
    const input = fixture();
    const auditRegistry = (commitSha: string) =>
      canonicalJson({
        recordEntries: [
          [
            'record:audit/doc-001',
            {
              kind: 'audit-risk',
              url: `https://github.com/Noveum/orbit/commit/${commitSha}`,
              sourceCommit: commitSha,
            },
          ],
        ],
        principalEntries: [],
      });
    const base = { ...input.base, registry: auditRegistry(baseSha) };
    const head = {
      ...base,
      ledger: ledger('Original risk', 'Original outcome', 'Ready for closure'),
      registry: auditRegistry('cccccccccccccccccccccccccccccccccccccccc'),
    };
    expect(
      validateReadinessScopePullRequest({
        ...input,
        changedFiles: [
          'docs/maintainers/readiness-ledger.md',
          'scripts/readiness-reference-registry.json',
        ],
        base,
        head,
        reviews: [],
      }),
    ).toContain('Existing registry entries are immutable.');
  });

  it('allows ordinary plan progress outside the governed findings table', () => {
    const input = fixture();
    const base = input.base;
    const head = { ...base, plan: `${base.plan}\n- [x] Implementation progress\n` };
    expect(
      validateReadinessScopePullRequest({
        ...input,
        changedFiles: ['docs/superpowers/plans/2026-08-09-open-source-readiness.md'],
        base,
        head,
        reviews: [],
      }),
    ).toEqual([]);
  });

  it('rejects ordinary changes to governed verified-evidence cells', () => {
    const input = fixture();
    const base = input.base;
    const head = { ...base, plan: base.plan.replace('| Audit |', '| Unreviewed claim |') };
    expect(
      validateReadinessScopePullRequest({
        ...input,
        changedFiles: ['docs/superpowers/plans/2026-08-09-open-source-readiness.md'],
        base,
        head,
        reviews: [],
      }),
    ).toContain('Non-semantic changes cannot modify governed plan finding rows.');
  });

  it('requires exact ledger and registry changes for a closure transition', () => {
    const input = fixture();
    const base = {
      ...input.base,
      ledger: ledger('Original risk', 'Original outcome', 'Ready for closure'),
    };
    const head = {
      ...base,
      ledger: ledger('Original risk', 'Original outcome', 'Closed'),
      registry: closureRegistry(),
    };
    expect(
      validateReadinessScopePullRequest({
        ...input,
        changedFiles: [
          'docs/maintainers/readiness-ledger.md',
          'scripts/readiness-reference-registry.json',
        ],
        base,
        head,
        readyEvidence: [readyEvidence()],
        reviews: [],
      }),
    ).toEqual([]);
    expect(
      validateReadinessScopePullRequest({
        ...input,
        changedFiles: [
          'docs/maintainers/readiness-ledger.md',
          'scripts/readiness-reference-registry.json',
          'apps/web/src/app/page.tsx',
        ],
        base,
        head,
        readyEvidence: [readyEvidence()],
        reviews: [],
      }),
    ).toContain('Closure transitions must use the exact ledger-and-registry file shape.');
  });

  it('rejects unrelated registry entries bundled with a valid seal transition', () => {
    const input = fixture();
    const base = {
      ...input.base,
      ledger: ledger('Original risk', 'Original outcome', 'Ready for closure'),
    };
    const source = JSON.parse(closureRegistry()) as {
      principalEntries: unknown[];
      recordEntries: unknown[];
    };
    source.recordEntries.push([
      'record:docs/prestage',
      { kind: 'docs', url: 'https://example.test/prestaged-evidence' },
    ]);
    const head = {
      ...base,
      ledger: ledger('Original risk', 'Original outcome', 'Closed'),
      registry: canonicalJson(source),
    };
    expect(
      validateReadinessScopePullRequest({
        ...input,
        changedFiles: [
          'docs/maintainers/readiness-ledger.md',
          'scripts/readiness-reference-registry.json',
        ],
        base,
        head,
        readyEvidence: [readyEvidence()],
        reviews: [],
      }),
    ).toContain('Registry changes contain entries outside the changed lifecycle state.');
  });

  it('rejects closure evidence added before the Ready state is sealed', () => {
    const input = fixture();
    const head = {
      ...input.base,
      ledger: ledger('Original risk', 'Original outcome', 'Ready for closure'),
      registry: closureRegistry(),
    };
    expect(
      validateReadinessScopePullRequest({
        ...input,
        changedFiles: [
          'docs/maintainers/readiness-ledger.md',
          'scripts/readiness-reference-registry.json',
        ],
        head,
        reviews: [],
      }),
    ).toContain('Registry changes contain entries outside the changed lifecycle state.');
  });

  it('allows a P1 exception to stage before a later independently proven seal', () => {
    const input = fixture();
    const ready = {
      ...input.base,
      ledger: stagedExceptionLedger('Ready for closure'),
    };
    expect(
      validateReadinessScopePullRequest({
        ...input,
        changedFiles: [
          'docs/maintainers/readiness-ledger.md',
          'scripts/readiness-reference-registry.json',
        ],
        base: input.base,
        head: ready,
        reviews: [],
      }),
    ).toEqual([]);
    const accepted = {
      ...ready,
      ledger: stagedExceptionLedger('Accepted P1 exception'),
      registry: closureRegistry(),
    };
    expect(
      validateReadinessScopePullRequest({
        ...input,
        changedFiles: [
          'docs/maintainers/readiness-ledger.md',
          'scripts/readiness-reference-registry.json',
        ],
        base: ready,
        head: accepted,
        readyEvidence: [readyEvidence()],
        reviews: [],
      }),
    ).toEqual([]);
  });

  it('rejects a closure compressed from Open through Ready into one pull request', () => {
    const input = fixture();
    const head = {
      ...input.base,
      ledger: ledger('Original risk', 'Original outcome', 'Closed'),
      registry: closureRegistry('cccccccccccccccccccccccccccccccccccccccc'),
    };
    expect(
      validateReadinessScopePullRequest({
        ...input,
        changedFiles: [
          'docs/maintainers/readiness-ledger.md',
          'scripts/readiness-reference-registry.json',
        ],
        head,
        readyEvidence: [readyEvidence('cccccccccccccccccccccccccccccccccccccccc', false)],
        reviews: [],
      }),
    ).toContain('Closure seals require a Ready for closure finding on the trusted base.');
  });

  it('rejects unauthenticated or mismatched prior Ready proof', () => {
    const input = fixture();
    const base = {
      ...input.base,
      ledger: ledger('Original risk', 'Original outcome', 'Ready for closure'),
    };
    const head = {
      ...base,
      ledger: ledger('Original risk', 'Original outcome', 'Closed'),
      registry: closureRegistry(),
    };
    const proof = readyEvidence();
    const runPullRequest = proof.runPullRequests[0];
    if (runPullRequest === undefined) throw new Error('Ready proof fixture is invalid.');
    expect(
      validateReadinessScopePullRequest({
        ...input,
        changedFiles: [
          'docs/maintainers/readiness-ledger.md',
          'scripts/readiness-reference-registry.json',
        ],
        base,
        head,
        readyEvidence: [{ ...proof, runStartedAt: '2026-08-09T09:30:00Z' }],
        reviews: [],
      }),
    ).toEqual([]);
    const invalidProofs = [
      { ...proof, baseContainsEvidence: false },
      { ...proof, pullRequestBaseRef: 'release' },
      { ...proof, pullRequestBaseRepository: 'attacker/orbit' },
      { ...proof, mergeCommitSha: headSha },
      { ...proof, statusState: 'failure' as const },
      { ...proof, statusUpdatedAt: '2026-08-09T10:30:00.000Z' },
      { ...proof, configuredWorkflowId: proof.runWorkflowId + 1 },
      { ...proof, runWorkflowPath: '.github/workflows/ci.yml' },
      { ...proof, runWorkflowDefinitionDigest: `sha256:${'0'.repeat(64)}` },
      { ...proof, runRepository: 'attacker/orbit' },
      { ...proof, runAttempt: 2 },
      { ...proof, runEvent: 'pull_request' },
      { ...proof, runHeadSha: headSha },
      { ...proof, definitionCommitIsEvidenceAncestor: false },
      {
        ...proof,
        runPullRequests: [...proof.runPullRequests, { ...runPullRequest, number: 124 }],
      },
      {
        ...proof,
        runPullRequests: [{ ...runPullRequest, headSha }],
      },
    ];
    for (const invalidProof of invalidProofs) {
      expect(
        validateReadinessScopePullRequest({
          ...input,
          changedFiles: [
            'docs/maintainers/readiness-ledger.md',
            'scripts/readiness-reference-registry.json',
          ],
          base,
          head,
          readyEvidence: [invalidProof],
          reviews: [],
        }),
      ).toContain('Seal transition has invalid independently authenticated Ready evidence.');
    }
    expect(
      validateReadinessScopePullRequest({
        ...input,
        changedFiles: [
          'docs/maintainers/readiness-ledger.md',
          'scripts/readiness-reference-registry.json',
        ],
        base,
        head,
        readyEvidence: [],
        reviews: [],
      }),
    ).toContain('Seal transition has invalid independently authenticated Ready evidence.');
  });

  it('allows later product changes when sealed terminal rows stay unchanged', () => {
    const input = fixture();
    const sealed = {
      ...input.base,
      ledger: ledger('Original risk', 'Original outcome', 'Closed'),
    };
    expect(
      validateReadinessScopePullRequest({
        ...input,
        changedFiles: ['apps/web/src/app/page.tsx'],
        base: sealed,
        head: sealed,
        reviews: [],
      }),
    ).toEqual([]);
  });

  it('rejects a same-status Closed rewrite through an unmerged Ready intermediate', () => {
    const input = fixture();
    const base = {
      ...input.base,
      ledger: stagedClosedLedger('Closed'),
      registry: closureRegistry(baseSha),
    };
    const intermediate = {
      ...base,
      ledger: stagedClosedLedger('Ready for closure'),
      registry: canonicalJson({ recordEntries: [], principalEntries: [] }),
    };
    const head = {
      ...intermediate,
      ledger: base.ledger.replace(
        'record:implementation/doc-001',
        'record:implementation/doc-001-replacement',
      ),
      registry: closureRegistry('cccccccccccccccccccccccccccccccccccccccc'),
    };
    expect(
      validateReadinessScopePullRequest({
        ...input,
        changedFiles: [
          'docs/maintainers/readiness-ledger.md',
          'scripts/readiness-reference-registry.json',
        ],
        base,
        head,
        reviews: [],
      }),
    ).toContain('Sealed readiness state is immutable.');
  });

  it('rejects mutation of a same-status accepted exception', () => {
    const input = fixture();
    const accepted = stagedExceptionLedger('Accepted P1 exception');
    const base = { ...input.base, ledger: accepted, registry: closureRegistry(baseSha) };
    const intermediate = {
      ...base,
      ledger: stagedExceptionLedger('Ready for closure'),
      registry: canonicalJson({ recordEntries: [], principalEntries: [] }),
    };
    const head = {
      ...intermediate,
      ledger: accepted.replace(
        'Self-hosted users cannot import legacy archives during migration.',
        'Self-hosted users cannot export legacy archives during migration.',
      ),
    };
    expect(
      validateReadinessScopePullRequest({
        ...input,
        changedFiles: ['docs/maintainers/readiness-ledger.md'],
        base,
        head,
        reviews: [],
      }),
    ).toContain('Sealed readiness state is immutable.');
  });

  it('rejects mutation of an existing closure record', () => {
    const input = fixture();
    const sealed = ledger('Original risk', 'Original outcome', 'Closed');
    const base = { ...input.base, ledger: sealed, registry: closureRegistry(baseSha) };
    const head = {
      ...base,
      registry: closureRegistry('cccccccccccccccccccccccccccccccccccccccc'),
    };
    expect(
      validateReadinessScopePullRequest({
        ...input,
        changedFiles: ['scripts/readiness-reference-registry.json'],
        base,
        head,
        reviews: [],
      }),
    ).toContain('Existing registry entries are immutable.');
  });

  it('does not load prior Ready proof again for unchanged sealed rows', async () => {
    const sealed = ledger('Original risk', 'Original outcome', 'Closed');
    let calls = 0;
    const proofs = await readyEvidenceForRegistry(
      '.',
      baseSha,
      sealed,
      sealed,
      closureRegistry(),
      'token',
      () => {
        calls += 1;
        return Promise.resolve(readyEvidence());
      },
    );
    expect(proofs).toEqual([]);
    expect(calls).toBe(0);
  });

  it('preserves manifest and audit bytes when governed semantics do not change', () => {
    const input = fixture();
    for (const head of [
      { ...input.base, audit: '{"tampered":true}' },
      { ...input.base, manifest: `${input.base.manifest}\n` },
    ]) {
      expect(
        validateReadinessScopePullRequest({
          ...input,
          changedFiles: ['docs/maintainers/readiness-scope-audit.json'],
          head,
          reviews: [],
        }),
      ).toContain('Non-semantic changes cannot modify the scope manifest or audit record.');
    }
  });

  it('requires the exact dedicated file shape for a scope change', () => {
    const input = fixture();
    expect(
      validateReadinessScopePullRequest({
        ...input,
        changedFiles: [...input.changedFiles, 'scripts/check-readiness-scope-pr.ts'],
      }),
    ).toContain('Scope changes must use the dedicated allowed-file shape.');
  });

  it('requires an exact one-step manifest version increment', () => {
    const input = fixture();
    const unchanged = manifest(
      'readiness-scope/2026-08-09-v1',
      'Canonical risk',
      'Canonical outcome',
    );
    const jumped = manifest('readiness-scope/2026-08-09-v3', 'Canonical risk', 'Canonical outcome');
    for (const value of [unchanged, jumped]) {
      expect(
        validateReadinessScopePullRequest({
          ...input,
          head: { ...input.head, manifest: value },
        }),
      ).toContain('Scope changes require an exact one-step manifest version increment.');
    }
  });

  it('rejects a recomputed manifest that does not match plan and ledger semantics', () => {
    const input = fixture();
    const weakenedManifest = manifest(
      'readiness-scope/2026-08-09-v2',
      'No remaining risk',
      'No remediation required',
    );
    const errors = validateReadinessScopePullRequest({
      ...input,
      head: { ...input.head, manifest: weakenedManifest },
    });
    expect(errors).toContain('Readiness scope artifacts do not match the governed manifest.');
    expect(errors.join('\n')).not.toContain('DOC-001');
  });

  it('requires new or materially changed rows to remain Open', () => {
    const input = fixture();
    const result = validateReadinessScopePullRequest({
      ...input,
      head: {
        ...input.head,
        ledger: ledger('Canonical risk', 'Canonical outcome', 'Closed'),
      },
    });
    expect(result).toContain('New or materially changed findings must remain Open.');
    expect(result.join('\n')).not.toContain('DOC-001');
  });

  it('rejects bundled state changes to semantically unaffected findings', () => {
    const input = withUnchangedFinding(fixture());
    const result = validateReadinessScopePullRequest({
      ...input,
      head: {
        ...input.head,
        ledger: input.head.ledger.replace(
          '| SEC-001 | P0 | Unchanged security risk | Security maintainer | principal:security-owner | Yes | Open |',
          '| SEC-001 | P0 | Unchanged security risk | Security maintainer | principal:security-owner | Yes | Closed |',
        ),
      },
    });
    expect(result).toContain('Scope changes cannot modify unaffected ledger state.');
    expect(result.join('\n')).not.toContain('SEC-001');
  });

  it('preserves unaffected exception state during a semantic scope change', () => {
    const input = withUnchangedAcceptedP1Finding(fixture());
    const exception =
      '| DOC-002 | principal:documentation-owner | 2026-12-01 | mitigation:record:mitigation/doc-002 | Operators must retain the legacy proxy until the migration completes. | risk:record:risk/doc-002 | decision:record:decision/doc-002;implementation=principal:implementation-owner;finding=principal:documentation-owner;approver=principal:release-owner | approver:principal:release-owner | not-required |';
    const addException = (value: string, limitation: string) =>
      value.replace(
        /\n$/,
        `\n${exception.replace('Operators must retain the legacy proxy until the migration completes.', limitation)}\n`,
      );
    const base = {
      ...input.base,
      ledger: addException(
        input.base.ledger,
        'Operators must retain the legacy proxy until the migration completes.',
      ),
    };
    const head = {
      ...input.head,
      ledger: addException(
        input.head.ledger,
        'Operators may remove the legacy proxy without completing the migration.',
      ),
    };
    expect(validateReadinessScopePullRequest({ ...input, base, head })).toContain(
      'Scope changes cannot modify unaffected exception state.',
    );
  });

  it('preserves governance prose outside changed scope rows', () => {
    const input = fixture();
    for (const head of [
      { ...input.head, plan: `${input.head.plan}\nUnreviewed plan policy override.\n` },
      { ...input.head, plan: `${input.head.plan}\n<!-- hidden policy override -->\n` },
      { ...input.head, ledger: `${input.head.ledger}\nUnreviewed ledger policy override.\n` },
    ]) {
      expect(validateReadinessScopePullRequest({ ...input, head })).toContain(
        'Scope changes cannot modify governance content outside changed finding rows.',
      );
    }
  });

  it('requires a canonical audit link and complete semantic change mapping', () => {
    const input = fixture();
    const audit = JSON.parse(input.head.audit) as Record<string, unknown>;
    for (const changedAudit of [
      { ...audit, reviewUrl: 'https://example.test/review/123' },
      { ...audit, reviewUrl: 'https://github.com:8443/Noveum/orbit/pull/123' },
      { ...audit, reviewUrl: 'https://github.com/Noveum/orbit/pull/123/files' },
      { ...audit, reviewUrl: 'https://github.com/Noveum/orbit/pull/not-a-number' },
      { ...audit, changedFindingIds: [] },
      { ...audit, noRiskDisappears: false },
    ]) {
      expect(
        validateReadinessScopePullRequest({
          ...input,
          head: { ...input.head, audit: JSON.stringify(changedAudit) },
        }),
      ).toContain('Scope change audit record is invalid or incomplete.');
    }
  });

  it('rejects duplicate keys in governed JSON artifacts', () => {
    const input = fixture();
    const duplicateManifest = input.head.manifest.replace(
      '{',
      '{"version":"readiness-scope/2099-01-01-v999",',
    );
    const duplicateAudit = input.head.audit.replace('{', '{"kind":"baseline",');
    const duplicateRegistry = input.head.registry.replace(
      '{',
      '{"recordEntries":[["record:audit/doc-001",{"kind":"risk","kind":"audit-risk","url":"https://example.test/risk","sourceCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]],',
    );
    for (const head of [
      { ...input.head, manifest: duplicateManifest },
      { ...input.head, audit: duplicateAudit },
      { ...input.head, registry: duplicateRegistry },
    ]) {
      expect(validateReadinessScopePullRequest({ ...input, head })).toContain(
        'Governed JSON artifacts must use unique object keys.',
      );
    }
  });

  it('rejects noncanonical governed JSON bytes', () => {
    const input = fixture();
    const head = {
      ...input.head,
      manifest: JSON.stringify(JSON.parse(input.head.manifest)),
    };
    expect(validateReadinessScopePullRequest({ ...input, head })).toContain(
      'Governed JSON artifacts must use canonical bytes.',
    );
  });

  it('caps the aggregate governed artifact input size', () => {
    const input = fixture();
    const large = 'x'.repeat(900_000);
    const result = readinessScopePrInputSchema.safeParse({
      ...input,
      base: { ...input.base, plan: large, ledger: large, registry: large },
      head: { ...input.head, plan: large, ledger: large, registry: large },
    });
    expect(result.success).toBe(false);
  });

  it('requires both maintainers latest opinionated review on the exact head', () => {
    const input = fixture();
    expect(
      validateReadinessScopePullRequest({ ...input, reviews: input.reviews.slice(0, 1) }),
    ).toContain('Scope change lacks both required exact-head approvals.');
    expect(
      validateReadinessScopePullRequest({
        ...input,
        reviews: input.reviews.map((review) =>
          review.login === 'pulkitxm' ? { ...review, commitId: baseSha } : review,
        ),
      }),
    ).toContain('Scope change lacks both required exact-head approvals.');
    expect(
      validateReadinessScopePullRequest({
        ...input,
        reviews: [
          ...input.reviews,
          {
            login: 'imshashank',
            state: 'CHANGES_REQUESTED',
            commitId: headSha,
            submittedAt: '2026-08-09T11:00:00.000Z',
          },
        ],
      }),
    ).toContain('Scope change lacks both required exact-head approvals.');
  });

  it('rejects a dismissed approval in the final fresh review snapshot', () => {
    const input = fixture();
    const freshReviews = [
      ...input.reviews,
      {
        login: 'imshashank',
        state: 'DISMISSED' as const,
        commitId: headSha,
        submittedAt: '2026-08-09T11:00:00.000Z',
      },
    ];
    expect(validateFinalReadinessScopeState(input, freshReviews, baseSha, headSha)).toContain(
      'Scope change lacks both required exact-head approvals.',
    );
    expect(validateFinalReadinessScopeState(input, input.reviews, headSha, headSha)).toContain(
      'Pull request head or base changed during scope validation.',
    );
  });

  it('requires a dedicated approved shape for future trust-root changes', () => {
    const input = fixture();
    const unchanged = {
      ...input,
      base: input.base,
      head: input.base,
      changedFiles: [
        'scripts/check-readiness-scope-pr.ts',
        'packages/db/tests/check-readiness-scope-pr.test.ts',
      ],
    };
    expect(validateReadinessScopePullRequest(unchanged)).toEqual([]);
    expect(validateReadinessScopePullRequest({ ...unchanged, reviews: [] })).toContain(
      'Trust-root changes lack both required exact-head approvals.',
    );
    expect(
      validateReadinessScopePullRequest({
        ...unchanged,
        changedFiles: ['.github/workflows/spoof.yml'],
        reviews: [],
      }),
    ).toContain('Trust-root changes lack both required exact-head approvals.');
    expect(
      validateReadinessScopePullRequest({
        ...unchanged,
        changedFiles: ['apps/web/package.json'],
        reviews: [],
      }),
    ).toContain('Trust-root changes lack both required exact-head approvals.');
    expect(
      validateReadinessScopePullRequest({
        ...unchanged,
        changedFiles: ['.github/actions/pre-existing-action/src/index.ts'],
        reviews: [],
      }),
    ).toContain('Trust-root changes lack both required exact-head approvals.');
    expect(
      validateReadinessScopePullRequest({
        ...unchanged,
        changedFiles: ['scripts/helpers/extensionless-tool'],
        reviews: [],
      }),
    ).toContain('Trust-root changes lack both required exact-head approvals.');
    for (const path of ['tsconfig.base.json', 'tsconfig.json', '.npmrc', '.env.local'])
      expect(
        validateReadinessScopePullRequest({ ...unchanged, changedFiles: [path], reviews: [] }),
      ).toContain('Trust-root changes lack both required exact-head approvals.');
    for (const changedFiles of [
      ['scripts/check-readiness-scope-pr.ts', 'apps/web/src/app/page.tsx'],
      [
        '.github/workflows/ci.yml',
        'docs/maintainers/readiness-ledger.md',
        'scripts/readiness-reference-registry.json',
      ],
    ]) {
      expect(validateReadinessScopePullRequest({ ...unchanged, changedFiles })).toContain(
        'Trust-root changes require the dedicated policy-update file shape.',
      );
    }
  });

  it('redacts untrusted identifiers and changed paths', () => {
    const input = fixture();
    const secret = 'LEAK-999';
    const result = validateReadinessScopePullRequest({
      ...input,
      changedFiles: [...input.changedFiles, secret],
      head: { ...input.head, plan: input.head.plan.replace('DOC-001', secret) },
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result.join('\n')).not.toContain(secret);
  });

  it('runs injected CLI fixtures without exposing rejected PR content', async () => {
    const root = resolve(import.meta.dir, '../../..');
    const directory = await mkdtemp(join(tmpdir(), 'orbit-readiness-scope-'));
    const validPath = join(directory, 'valid.json');
    const invalidPath = join(directory, 'invalid.json');
    const secret = 'LEAK-999';
    try {
      await writeFile(validPath, JSON.stringify(fixture()));
      const invalid = fixture();
      await writeFile(
        invalidPath,
        JSON.stringify({
          ...invalid,
          changedFiles: [...invalid.changedFiles, secret],
          head: { ...invalid.head, plan: invalid.head.plan.replace('DOC-001', secret) },
        }),
      );
      const valid = spawnSync(
        process.execPath,
        ['scripts/check-readiness-scope-pr.ts', validPath],
        {
          cwd: root,
          encoding: 'utf8',
        },
      );
      expect(valid.status).toBe(0);
      expect(String(valid.stdout)).toContain('OK: readiness scope pull request policy passed.');
      const rejected = spawnSync(
        process.execPath,
        ['scripts/check-readiness-scope-pr.ts', invalidPath],
        { cwd: root, encoding: 'utf8' },
      );
      expect(rejected.status).toBe(1);
      expect(`${String(rejected.stdout)}${String(rejected.stderr)}`).not.toContain(secret);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('reads only regular NUL-free strictly decoded UTF-8 Git artifacts', async () => {
    const module = (await import('../../../scripts/check-readiness-scope-pr.ts')) as Readonly<
      Record<string, unknown>
    >;
    const reader = module['readGitArtifact'];
    expect(typeof reader).toBe('function');
    if (typeof reader !== 'function') return;
    const readArtifact = reader as (root: string, commit: string, path: string) => string;
    const directory = await mkdtemp(join(tmpdir(), 'orbit-readiness-artifact-'));
    const artifactPath = join(directory, 'artifact.md');
    const git = (args: readonly string[]) => {
      const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
      if (result.status !== 0) throw new Error('Git fixture operation failed.');
      return String(result.stdout).trim();
    };
    try {
      git(['init']);
      git(['config', 'user.email', 'fixture@example.test']);
      git(['config', 'user.name', 'Fixture']);
      await writeFile(artifactPath, 'valid UTF-8\n');
      git(['add', 'artifact.md']);
      git(['commit', '-m', 'valid']);
      const validCommit = git(['rev-parse', 'HEAD']);
      expect(readArtifact(directory, validCommit, 'artifact.md')).toBe('valid UTF-8\n');

      await chmod(artifactPath, 0o755);
      git(['add', 'artifact.md']);
      git(['commit', '-m', 'executable']);
      const executableCommit = git(['rev-parse', 'HEAD']);
      expect(() => readArtifact(directory, executableCommit, 'artifact.md')).toThrow();

      await writeFile(artifactPath, Buffer.from('before\0after'));
      git(['add', 'artifact.md']);
      git(['commit', '-m', 'nul']);
      const nulCommit = git(['rev-parse', 'HEAD']);
      expect(() => readArtifact(directory, nulCommit, 'artifact.md')).toThrow();

      await writeFile(artifactPath, Buffer.from([0xc3, 0x28]));
      git(['add', 'artifact.md']);
      git(['commit', '-m', 'utf8']);
      const malformedCommit = git(['rev-parse', 'HEAD']);
      expect(() => readArtifact(directory, malformedCommit, 'artifact.md')).toThrow();

      await rm(artifactPath);
      await symlink('target.md', artifactPath);
      git(['add', 'artifact.md']);
      git(['commit', '-m', 'symlink']);
      const symlinkCommit = git(['rev-parse', 'HEAD']);
      expect(() => readArtifact(directory, symlinkCommit, 'artifact.md')).toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);

  it('parses raw Git diffs and rejects invalid governed modes or statuses', () => {
    const zero = '0'.repeat(40);
    const before = '1'.repeat(40);
    const after = '2'.repeat(40);
    const encoded = (value: string) => new TextEncoder().encode(value);
    expect(
      parseRawGitDiff(
        encoded(
          `:100644 100644 ${before} ${after} M\0apps/web/src/app/page.tsx\0:000000 100755 ${zero} ${after} A\0scripts/tool.ts\0`,
        ),
      ),
    ).toEqual(['apps/web/src/app/page.tsx', 'scripts/tool.ts']);
    for (const value of [
      `:100644 100755 ${before} ${after} M\0docs/maintainers/readiness-ledger.md\0`,
      `:000000 100644 ${zero} ${after} A\0scripts/readiness-scope-manifest.json\0`,
      `:000000 100644 ${before} ${after} A\0scripts/tool.ts\0`,
      `:100644 100644 ${before} ${zero} M\0scripts/tool.ts\0`,
      `:100644 100644 ${before} ${after} R100\0apps/web/src/app/page.tsx\0`,
      `:100644 100644 ${before} ${after} M\0../outside\0`,
      `:100644 100644 ${before} ${after} M\0line\nbreak\0`,
      `:100644 100644 ${before} ${after} M\0control\u007fpath\0`,
      `:100644 100644 ${before} ${after} M\0duplicate\0:100644 100644 ${before} ${after} M\0duplicate\0`,
      `:100644 100644 ${before} ${after} M\0missing-terminator`,
    ]) {
      expect(() => parseRawGitDiff(encoded(value))).toThrow();
    }
    expect(() => parseRawGitDiff(Uint8Array.from([0xc3, 0x28]))).toThrow();
  });

  it('accepts review webhook identity from the nested pull request', () => {
    const result = pullRequestTargetEventSchema.safeParse({
      action: 'dismissed',
      pull_request: {
        number: 123,
        base: { ref: 'main', sha: baseSha },
        head: { sha: headSha },
      },
      review: { user: { login: 'imshashank' } },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.pull_request.number).toBe(123);
  });

  it('accepts live pull request target run metadata with nullable nested repositories', () => {
    const proof = readyEvidence();
    const result = githubWorkflowAttemptSchema.safeParse({
      workflow_id: proof.runWorkflowId,
      head_sha: proof.pullRequestHeadSha,
      conclusion: 'success',
      run_attempt: 1,
      event: 'pull_request_target',
      path: '.github/workflows/readiness-scope.yml',
      run_started_at: proof.runStartedAt,
      updated_at: proof.runUpdatedAt,
      repository: { full_name: 'Noveum/orbit' },
      head_repository: { full_name: 'contributor/orbit' },
      pull_requests: [
        {
          number: proof.pullRequestNumber,
          head: { sha: proof.pullRequestHeadSha, repo: null },
          base: { ref: 'main', sha: proof.pullRequestBaseSha, repo: null },
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});
