import { describe, expect, it } from 'bun:test';
import {
  currentUtcDate,
  parseExceptionRows,
  parseFindingRows,
  parsePlanFindings,
  validateReadinessLedger,
} from '../../../scripts/check-readiness-ledger.ts';
import {
  type EvidenceRecord,
  type ReadinessReferenceRegistry,
  type ReadinessReferenceRegistrySource,
  readinessReferenceRegistrySource,
} from '../../../scripts/readiness-reference-registry.ts';
import type { ReadinessScopeManifest } from '../../../scripts/readiness-scope-manifest.ts';

const verificationDate = '2026-08-09';
const implementationBaselineCommit = '808d7148478889437f42369a54e0553924352eaa';
const candidateCommit = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const otherCandidateCommit = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const testScopeManifest = {
  version: 'readiness-scope/2026-08-09-v1',
  digest: 'sha256:6259a22b5bbd33ac7d4dc3f6a65ac66c932a8f6fa3068ffc63c80c1a59d6b2c4',
  findings: [
    { id: 'CI-002', priority: 'P1' },
    { id: 'DOC-001', priority: 'P1' },
    { id: 'SEC-001', priority: 'P0' },
  ],
} as const;

const plan = `
## Findings register

| ID | Priority | Finding | Verified evidence | Required outcome |
| --- | --- | --- | --- | --- |
| SEC-001 | P0 | Security finding with \\| an escaped pipe | Audit | Outcome |
| DOC-001 | P1 | Documentation finding | Audit | Outcome |
| CI-002 | P1 | Supply chain finding | Audit | Outcome |
`;

const findingHeader =
  '| ID | Priority | Finding | Accountable owner role | Accountable owner reference | Security authority required | Status | Implementation evidence | Change evidence | Release-gate evidence | Documentation evidence | Objective close condition | Residual-risk record | Decision record | Independent Release approver | Security authority record |';
const findingSeparator =
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';
const exceptionHeader =
  '| Finding ID | Accountable owner reference | Expiry date | Mitigation evidence | Public limitation | Residual-risk record | Decision record | Independent Release approver | Security authority record |';
const exceptionSeparator = '| --- | --- | --- | --- | --- | --- | --- | --- | --- |';

const resolvedRegistry: ReadinessReferenceRegistry = {
  records: new Map<string, EvidenceRecord>([
    [
      'record:audit/doc-001',
      {
        kind: 'audit-risk',
        url: 'https://github.com/Noveum/orbit/commit/cccccccccccccccccccccccccccccccccccccccc',
        sourceCommit: 'cccccccccccccccccccccccccccccccccccccccc',
      },
    ],
    [
      'record:implementation/doc-001',
      {
        kind: 'implementation',
        url: 'https://example.test/implementation/doc-001',
        observedAt: '2026-08-09T11:00:00.000Z',
      },
    ],
    ['record:test/doc-001', candidateEvidence('test')],
    ['record:gate/doc-001', candidateEvidence('gate')],
    ['record:docs/doc-001', { kind: 'docs', url: 'https://example.test/docs/doc-001' }],
    ['record:decision/doc-001', candidateEvidence('decision')],
    [
      'record:mitigation/doc-001',
      { kind: 'mitigation', url: 'https://example.test/mitigation/doc-001' },
    ],
    ['record:non-behavioral/doc-001', candidateEvidence('non-behavioral')],
    [
      'record:justification/doc-001',
      { kind: 'justification', url: 'https://example.test/justification/doc-001' },
    ],
    [
      'record:failing-test/doc-001',
      {
        kind: 'failing-test',
        url: 'https://example.test/failing-test/doc-001',
        observedAt: '2026-08-09T10:00:00.000Z',
      },
    ],
  ]),
  principals: new Map([
    [
      'principal:documentation-person',
      {
        kind: 'human',
        role: 'Documentation maintainer',
        subjectId: 'subject:documentation',
        assignmentUrl: 'https://example.test/assignments/documentation',
      },
    ],
    [
      'principal:implementation-person',
      {
        kind: 'human',
        role: 'Repository maintainer',
        subjectId: 'subject:implementation',
        assignmentUrl: 'https://example.test/assignments/implementation',
      },
    ],
    [
      'principal:documentation-alias',
      {
        kind: 'human',
        role: 'Repository maintainer',
        subjectId: 'subject:documentation',
        assignmentUrl: 'https://example.test/assignments/documentation-alias',
      },
    ],
    [
      'principal:release-person',
      {
        kind: 'human',
        role: 'Release maintainer',
        subjectId: 'subject:release',
        assignmentUrl: 'https://example.test/assignments/release',
      },
    ],
    [
      'principal:release-alias',
      {
        kind: 'human',
        role: 'Release maintainer',
        subjectId: 'subject:release',
        assignmentUrl: 'https://example.test/assignments/release-alias',
      },
    ],
    [
      'principal:security-person',
      {
        kind: 'human',
        role: 'Security maintainer',
        subjectId: 'subject:security',
        assignmentUrl: 'https://example.test/assignments/security',
      },
    ],
    [
      'principal:data-person',
      {
        kind: 'human',
        role: 'Data maintainer',
        subjectId: 'subject:data',
        assignmentUrl: 'https://example.test/assignments/data',
      },
    ],
    [
      'principal:security-owner',
      {
        kind: 'role-alias',
        role: 'Security maintainer',
        assignmentUrl: 'https://example.test/roles/security',
      },
    ],
    [
      'principal:release-owner',
      {
        kind: 'role-alias',
        role: 'Release maintainer',
        assignmentUrl: 'https://example.test/roles/release',
      },
    ],
  ]),
};

function candidateIdentity(commitSha = candidateCommit) {
  return {
    kind: 'git-commit',
    commitSha,
    commitUrl: `https://github.com/Noveum/orbit/commit/${commitSha}`,
  } as const;
}

function candidateEvidence(
  kind: 'test' | 'gate' | 'decision' | 'non-behavioral',
  commitSha = candidateCommit,
  commitUrl = `https://github.com/Noveum/orbit/commit/${commitSha}`,
) {
  const observedAt = {
    test: '2026-08-09T12:00:00.000Z',
    'non-behavioral': '2026-08-09T12:00:00.000Z',
    gate: '2026-08-09T13:00:00.000Z',
    decision: '2026-08-09T14:00:00.000Z',
  }[kind];
  return {
    kind,
    url: `https://evidence.example.test/${kind}/doc-001`,
    observedAt,
    candidate: { ...candidateIdentity(commitSha), commitUrl },
  } as const;
}

function uncheckedRegistry(
  records: ReadonlyMap<string, unknown>,
  principals: ReadonlyMap<string, unknown> = resolvedRegistry.principals,
): ReadinessReferenceRegistrySource {
  return {
    recordEntries: [...records.entries()],
    principalEntries:
      principals === resolvedRegistry.principals
        ? validPrincipalSourceEntries()
        : [...principals.entries()],
  } as unknown as ReadinessReferenceRegistrySource;
}

function validPrincipalSourceEntries(): ReadonlyArray<readonly [string, unknown]> {
  return [...resolvedRegistry.principals.entries()].map(([key, value]) => {
    if (key === 'principal:documentation-alias')
      return [
        key,
        {
          kind: 'human-alias',
          role: 'Documentation maintainer',
          canonicalPrincipal: 'principal:documentation-person',
          assignmentUrl: 'https://example.test/assignments/documentation-alias',
        },
      ] as const;
    if (key === 'principal:release-alias')
      return [
        key,
        {
          kind: 'human-alias',
          role: 'Release maintainer',
          canonicalPrincipal: 'principal:release-person',
          assignmentUrl: 'https://example.test/assignments/release-alias',
        },
      ] as const;
    return [key, value] as const;
  });
}

function sourceBackedRegistry(
  recordEntries: ReadonlyArray<readonly [string, unknown]> = [
    ...resolvedRegistry.records.entries(),
  ],
  principalEntries: ReadonlyArray<readonly [string, unknown]> = validPrincipalSourceEntries(),
): ReadinessReferenceRegistrySource {
  return {
    recordEntries,
    principalEntries,
  } as unknown as ReadinessReferenceRegistrySource;
}

function findingRow(overrides: Readonly<Record<string, string>> = {}): string {
  const values = {
    id: 'DOC-001',
    priority: 'P1',
    finding: 'Documentation finding',
    ownerRole: 'Documentation maintainer',
    ownerReference: 'principal:documentation-owner',
    securityRequired: 'No',
    status: 'Open',
    implementation: 'pending:open',
    change: 'pending:open',
    releaseGate: 'pending:open',
    documentation: 'pending:open',
    closeCondition: 'A tested operator outcome is published.',
    residualRisk: 'risk:record:audit/doc-001',
    decision: 'pending:open',
    approver: 'pending:open',
    authority: 'not-required',
    ...overrides,
  };
  return `| ${values.id} | ${values.priority} | ${values.finding} | ${values.ownerRole} | ${values.ownerReference} | ${values.securityRequired} | ${values.status} | ${values.implementation} | ${values.change} | ${values.releaseGate} | ${values.documentation} | ${values.closeCondition} | ${values.residualRisk} | ${values.decision} | ${values.approver} | ${values.authority} |`;
}

function ledger(rows: readonly string[], exceptions: readonly string[] = []): string {
  return `
## Readiness findings register

${findingHeader}
${findingSeparator}
${rows.join('\n')}

## P1 exception register

${exceptionHeader}
${exceptionSeparator}
${exceptions.join('\n')}
`;
}

function exceptionRow(overrides: Readonly<Record<string, string>> = {}): string {
  const values = {
    id: 'DOC-001',
    ownerReference: 'principal:documentation-owner',
    expiry: '2026-09-01',
    mitigation: 'mitigation:record:doc-001',
    limitation: 'A documented temporary limitation remains.',
    residualRisk: 'risk:record:audit/doc-001',
    decision:
      'decision:record:release/doc-001;implementation=principal:writer-a;finding=principal:documentation-owner;approver=principal:release-a',
    approver: 'approver:principal:release-a',
    authority: 'not-required',
    ...overrides,
  };
  return `| ${values.id} | ${values.ownerReference} | ${values.expiry} | ${values.mitigation} | ${values.limitation} | ${values.residualRisk} | ${values.decision} | ${values.approver} | ${values.authority} |`;
}

function parsedLedger(rows: readonly string[], exceptions: readonly string[] = []) {
  const value = ledger(rows, exceptions);
  return {
    findings: parseFindingRows(value),
    exceptions: parseExceptionRows(value),
  };
}

function errors(rows: readonly string[], exceptions: readonly string[] = []): string[] {
  const parsed = parsedLedger(rows, exceptions);
  return validateReadinessLedger(
    parsePlanFindings(plan),
    parsed.findings,
    parsed.exceptions,
    verificationDate,
    readinessReferenceRegistrySource,
    testScopeManifest,
  );
}

function resolvedErrors(rows: readonly string[], exceptions: readonly string[] = []): string[] {
  const parsed = parsedLedger(rows, exceptions);
  return validateReadinessLedger(
    parsePlanFindings(plan),
    parsed.findings,
    parsed.exceptions,
    verificationDate,
    sourceBackedRegistry(),
    testScopeManifest,
  );
}

function resolvedClosedRow(overrides: Readonly<Record<string, string>> = {}): string {
  return findingRow({
    ownerReference: 'principal:documentation-person',
    status: 'Closed',
    implementation: 'implementation:record:implementation/doc-001',
    change: 'test:first=record:failing-test/doc-001;passing=record:test/doc-001',
    releaseGate: 'gate:record:gate/doc-001',
    documentation: 'docs:record:docs/doc-001',
    decision:
      'decision:record:decision/doc-001;implementation=principal:implementation-person;finding=principal:documentation-person;approver=principal:release-person',
    approver: 'approver:principal:release-person',
    ...overrides,
  });
}

function scopedOpenRows(docPriority = 'P1'): string[] {
  return [
    findingRow({
      id: 'SEC-001',
      priority: 'P0',
      ownerRole: 'Security maintainer',
      ownerReference: 'principal:security-owner',
      securityRequired: 'Yes',
      authority: 'pending:open',
      residualRisk: 'risk:record:audit/f1bfdc3',
    }),
    findingRow({ priority: docPriority, residualRisk: 'risk:record:audit/f1bfdc3' }),
    findingRow({
      id: 'CI-002',
      ownerRole: 'Release maintainer',
      ownerReference: 'principal:release-owner',
      securityRequired: 'Yes',
      authority: 'pending:open',
      residualRisk: 'risk:record:audit/f1bfdc3',
    }),
  ];
}

describe('readiness ledger checker', () => {
  it('rejects correlated plan and ledger scope removal against the audited manifest', () => {
    const parsed = parsedLedger(scopedOpenRows().filter((row) => !row.includes('| DOC-001 |')));
    const result = validateReadinessLedger(
      parsePlanFindings(plan).filter((finding) => finding.id !== 'DOC-001'),
      parsed.findings,
      parsed.exceptions,
      verificationDate,
      readinessReferenceRegistrySource,
      testScopeManifest,
    );
    expect(result).toContain('Audited scope ID DOC-001 is missing from the plan.');
    expect(result).toContain('Audited scope ID DOC-001 is missing from the ledger.');
  });

  it('rejects correlated plan and ledger reprioritization against the audited manifest', () => {
    const reprioritizedPlan = plan.replace('| DOC-001 | P1 |', '| DOC-001 | P0 |');
    const parsed = parsedLedger(scopedOpenRows('P0'));
    const result = validateReadinessLedger(
      parsePlanFindings(reprioritizedPlan),
      parsed.findings,
      parsed.exceptions,
      verificationDate,
      readinessReferenceRegistrySource,
      testScopeManifest,
    );
    expect(result).toContain('Audited scope priority mismatch for plan ID DOC-001.');
    expect(result).toContain('Audited scope priority mismatch for ledger ID DOC-001.');
  });

  it('rejects empty plan and ledger inputs against a nonempty audited manifest', () => {
    expect(
      validateReadinessLedger(
        [],
        [],
        [],
        verificationDate,
        readinessReferenceRegistrySource,
        testScopeManifest,
      ),
    ).toEqual(
      expect.arrayContaining([
        'Plan audited scope is empty.',
        'Ledger audited scope is empty.',
        'Audited scope ID DOC-001 is missing from the plan.',
        'Audited scope ID DOC-001 is missing from the ledger.',
      ]),
    );
  });

  it('rejects and redacts every malformed raw plan ID before scope comparison', () => {
    const secret = 'private-token-marker';
    const malformedPlan = plan.replace('DOC-001', secret);
    const result = validateReadinessLedger(
      parsePlanFindings(malformedPlan),
      [],
      [],
      verificationDate,
      readinessReferenceRegistrySource,
      testScopeManifest,
    );
    expect(result).toContain('Plan finding row 4 has an invalid ID.');
    expect(result.join('\n')).not.toContain(secret);
  });

  it('validates raw P2 and P3 plan rows without adding them to audited P0 and P1 scope', () => {
    const extendedPlan = plan.replace(
      '| CI-002 | P1 | Supply chain finding | Audit | Outcome |',
      [
        '| CI-002 | P1 | Supply chain finding | Audit | Outcome |',
        '| REPO-002 | P2 | Maintainability finding | Audit | Outcome |',
        '| EXP-999 | P3 | Optional finding | Audit | Outcome |',
      ].join('\n'),
    );
    const parsed = parsedLedger(scopedOpenRows());
    const result = validateReadinessLedger(
      parsePlanFindings(extendedPlan),
      parsed.findings,
      parsed.exceptions,
      verificationDate,
      readinessReferenceRegistrySource,
      testScopeManifest,
    );
    expect(result).not.toContain('Plan finding ID REPO-002 has an invalid priority.');
    expect(result).not.toContain('Missing ledger finding ID: REPO-002.');
    expect(result).not.toContain('Missing ledger finding ID: EXP-999.');
  });

  it('validates the audited manifest version, digest, entries, uniqueness, and nonempty scope', () => {
    const secret = 'private-manifest-id';
    const invalidManifest = {
      version: 'draft',
      digest: `sha256:${'0'.repeat(64)}`,
      findings: [
        { id: 'DOC-001', priority: 'P1' },
        { id: 'DOC-001', priority: 'P1' },
        { id: secret, priority: 'P2' },
      ],
    } as unknown as ReadinessScopeManifest;
    const result = validateReadinessLedger(
      [],
      [],
      [],
      verificationDate,
      readinessReferenceRegistrySource,
      invalidManifest,
    );
    expect(result).toEqual(
      expect.arrayContaining([
        'Audited scope manifest has an invalid version.',
        'Audited scope manifest digest does not match its entries.',
        'Audited scope manifest entry 3 has an invalid ID.',
        'Audited scope manifest entry 3 has an invalid priority.',
        'Audited scope manifest has duplicate finding ID DOC-001.',
      ]),
    );
    expect(result.join('\n')).not.toContain(secret);
    const emptyManifest = {
      version: 'readiness-scope/2026-08-09-v2',
      digest: `sha256:${'0'.repeat(64)}`,
      findings: [],
    } as const;
    expect(
      validateReadinessLedger(
        [],
        [],
        [],
        verificationDate,
        readinessReferenceRegistrySource,
        emptyManifest,
      ),
    ).toContain('Audited scope manifest is empty.');
  });

  it('derives the production verification date from the current UTC calendar day', () => {
    expect(currentUtcDate(new Date('2026-08-11T00:30:00+05:30'))).toBe('2026-08-10');
  });

  it('rejects an exception after its formerly future expiry using an injected production date', () => {
    const finding = findingRow({
      status: 'Accepted P1 exception',
      implementation: 'implementation:record:pull/123',
      change: 'test:record:test/doc-001',
      releaseGate: 'gate:record:ci/doc-001',
      documentation: 'docs:record:docs/doc-001',
      decision:
        'decision:record:release/doc-001;implementation=principal:writer-a;finding=principal:documentation-owner;approver=principal:release-a',
      approver: 'approver:principal:release-a',
    });
    const parsed = parsedLedger([finding], [exceptionRow({ expiry: '2026-08-10' })]);
    expect(
      validateReadinessLedger(
        parsePlanFindings(plan),
        parsed.findings,
        parsed.exceptions,
        '2026-08-11',
        readinessReferenceRegistrySource,
        testScopeManifest,
      ),
    ).toContain('P1 exception row 3 has an expiry date that is not after the verification date.');
  });

  it('accepts an in-progress row only with linked implementation evidence', () => {
    const row = findingRow({
      status: 'In progress',
      implementation: 'implementation:record:pull/123',
    });
    const result = errors([row]);
    expect(result).not.toContain('Finding ID DOC-001 has invalid implementation evidence.');
    expect(result).not.toContain('Finding ID DOC-001 has invalid decision record.');
    expect(errors([findingRow({ status: 'In progress' })])).toContain(
      'Finding ID DOC-001 has invalid implementation evidence for In progress status.',
    );
  });

  it('rejects unresolved evidence, wrong-role approvers, and self-approved non-behavioral evidence', () => {
    const row = findingRow({
      status: 'Closed',
      implementation: 'implementation:record:missing/pull',
      change:
        'test-na:record:missing/test;justification=record:missing/why;approver=principal:documentation-owner',
      releaseGate: 'gate:record:missing/gate',
      documentation: 'docs:record:missing/docs',
      decision:
        'decision:record:missing/decision;implementation=principal:writer-a;finding=principal:documentation-owner;approver=principal:documentation-owner',
      approver: 'approver:principal:documentation-owner',
    });
    const parsed = parsedLedger([row]);
    const result = validateReadinessLedger(
      parsePlanFindings(plan),
      parsed.findings,
      parsed.exceptions,
      verificationDate,
      readinessReferenceRegistrySource,
      testScopeManifest,
    );
    expect(result).toContain('Finding ID DOC-001 has an unresolved reference.');
    expect(result).toContain(
      'Finding ID DOC-001 has an approver without Release maintainer authority.',
    );
    expect(result).toContain('Finding ID DOC-001 has an invalid non-behavioral approval.');
  });

  it('binds owner and security authority references to exact registered roles', () => {
    expect(resolvedErrors([resolvedClosedRow({ ownerRole: 'Security maintainer' })])).toContain(
      'Finding ID DOC-001 has an accountable owner role mismatch.',
    );

    expect(
      resolvedErrors([
        resolvedClosedRow({
          securityRequired: 'Yes',
          authority: 'authority:principal:data-person',
        }),
      ]),
    ).toContain('Finding ID DOC-001 has security authority without Security maintainer authority.');
  });

  it('uses registered subject identity for independence across aliases', () => {
    const result = resolvedErrors([
      resolvedClosedRow({
        decision:
          'decision:record:decision/doc-001;implementation=principal:documentation-alias;finding=principal:documentation-person;approver=principal:release-person',
      }),
    ]);
    expect(result).toContain('Finding ID DOC-001 has a decision with non-independent subjects.');
  });

  it('requires terminal principals to resolve to human assignment subjects with valid HTTPS links', () => {
    expect(
      resolvedErrors([
        resolvedClosedRow({
          ownerRole: 'Release maintainer',
          ownerReference: 'principal:release-owner',
          decision:
            'decision:record:decision/doc-001;implementation=principal:implementation-person;finding=principal:release-owner;approver=principal:release-person',
        }),
      ]),
    ).toContain('Finding ID DOC-001 requires a human accountable owner assignment.');

    const invalidPrincipals = new Map(resolvedRegistry.principals);
    invalidPrincipals.set('principal:release-person', {
      kind: 'human',
      role: 'Release maintainer',
      subjectId: 'subject:release',
      assignmentUrl: 'http://example.test/assignments/release',
    });
    const parsed = parsedLedger([resolvedClosedRow()]);
    expect(
      validateReadinessLedger(
        parsePlanFindings(plan),
        parsed.findings,
        parsed.exceptions,
        verificationDate,
        uncheckedRegistry(resolvedRegistry.records, invalidPrincipals),
        testScopeManifest,
      ),
    ).toContain('Registry principal entry 4 has an invalid assignment link.');

    expect(
      resolvedErrors([
        resolvedClosedRow({
          decision:
            'decision:record:decision/doc-001;implementation=principal:security-owner;finding=principal:documentation-person;approver=principal:release-person',
        }),
      ]),
    ).toContain('Finding ID DOC-001 requires human decision principal assignments.');

    const invalidSubjectPrincipals = new Map(resolvedRegistry.principals);
    invalidSubjectPrincipals.set('principal:documentation-person', {
      kind: 'human',
      role: 'Documentation maintainer',
      subjectId: '   ',
      assignmentUrl: 'https://example.test/assignments/documentation',
    });
    expect(
      validateReadinessLedger(
        parsePlanFindings(plan),
        parsed.findings,
        parsed.exceptions,
        verificationDate,
        uncheckedRegistry(resolvedRegistry.records, invalidSubjectPrincipals),
        testScopeManifest,
      ),
    ).toContain('Registry principal entry 1 has an invalid subject identity.');
  });

  it('requires every evidence field to resolve to its exact type and HTTPS link', () => {
    const wrongCategoryRows = [
      resolvedClosedRow({ implementation: 'implementation:record:test/doc-001' }),
      resolvedClosedRow({
        change: 'test:first=record:failing-test/doc-001;passing=record:implementation/doc-001',
      }),
      resolvedClosedRow({ releaseGate: 'gate:record:test/doc-001' }),
      resolvedClosedRow({ documentation: 'docs:record:gate/doc-001' }),
      resolvedClosedRow({ residualRisk: 'risk:record:docs/doc-001' }),
      resolvedClosedRow({
        decision:
          'decision:record:audit/doc-001;implementation=principal:implementation-person;finding=principal:documentation-person;approver=principal:release-person',
      }),
      resolvedClosedRow({ implementation: 'implementation:record:audit/doc-001' }),
      resolvedClosedRow({
        change: 'test:first=record:failing-test/doc-001;passing=record:audit/doc-001',
      }),
      resolvedClosedRow({ releaseGate: 'gate:record:audit/doc-001' }),
      resolvedClosedRow({ documentation: 'docs:record:audit/doc-001' }),
    ];
    for (const row of wrongCategoryRows) {
      expect(resolvedErrors([row])).toContain('Finding ID DOC-001 has an evidence type mismatch.');
    }

    const parsed = parsedLedger([resolvedClosedRow()]);
    const invalidLinkRecords = new Map(resolvedRegistry.records);
    invalidLinkRecords.set('record:test/doc-001', {
      ...candidateEvidence('test'),
      url: 'http://example.test/test/doc-001',
    });
    expect(
      validateReadinessLedger(
        parsePlanFindings(plan),
        parsed.findings,
        parsed.exceptions,
        verificationDate,
        uncheckedRegistry(invalidLinkRecords),
        testScopeManifest,
      ),
    ).toContain('Registry record entry 3 has an invalid evidence link.');

    const mislabeledRecords = new Map(resolvedRegistry.records);
    mislabeledRecords.set('record:audit/mislabeled', {
      kind: 'implementation',
      url: 'https://example.test/implementation/mislabeled',
      observedAt: '2026-08-09T11:00:00.000Z',
    });
    const mislabeled = parsedLedger([
      resolvedClosedRow({ implementation: 'implementation:record:audit/mislabeled' }),
    ]);
    expect(
      validateReadinessLedger(
        parsePlanFindings(plan),
        mislabeled.findings,
        mislabeled.exceptions,
        verificationDate,
        uncheckedRegistry(mislabeledRecords),
        testScopeManifest,
      ),
    ).toContain('Registry record entry 11 has a namespace that does not match its evidence kind.');
  });

  it('rejects candidate evidence whose commit URL and commit metadata disagree', () => {
    const records = new Map<string, unknown>(resolvedRegistry.records);
    records.set(
      'record:test/doc-001',
      candidateEvidence(
        'test',
        candidateCommit,
        `https://github.com/Noveum/orbit/commit/${otherCandidateCommit}`,
      ),
    );
    const parsed = parsedLedger([resolvedClosedRow()]);
    const result = validateReadinessLedger(
      parsePlanFindings(plan),
      parsed.findings,
      parsed.exceptions,
      verificationDate,
      uncheckedRegistry(records),
      testScopeManifest,
    );
    expect(result).toContain('Registry record entry 3 has candidate URL metadata mismatch.');
  });

  it('rejects a terminal record whose evidence URL names a different commit', () => {
    const records = new Map<string, unknown>(resolvedRegistry.records);
    records.set('record:test/doc-001', {
      ...candidateEvidence('test'),
      url: `https://github.com/Noveum/orbit/commit/${otherCandidateCommit}`,
    });
    const parsed = parsedLedger([resolvedClosedRow()]);
    const result = validateReadinessLedger(
      parsePlanFindings(plan),
      parsed.findings,
      parsed.exceptions,
      verificationDate,
      uncheckedRegistry(records),
      testScopeManifest,
    );
    expect(result).toContain('Registry record entry 3 has evidence URL candidate mismatch.');
  });

  it('rejects terminal evidence with contradictory legacy release labels', () => {
    const records = new Map<string, unknown>(resolvedRegistry.records);
    records.set('record:test/doc-001', {
      ...candidateEvidence('test'),
      releaseCommit: implementationBaselineCommit,
    });
    const parsed = parsedLedger([resolvedClosedRow()]);
    const result = validateReadinessLedger(
      parsePlanFindings(plan),
      parsed.findings,
      parsed.exceptions,
      verificationDate,
      uncheckedRegistry(records),
      testScopeManifest,
    );
    expect(result).toContain('Registry record entry 3 has contradictory candidate metadata.');
  });

  it('rejects short and implementation-baseline release candidates', () => {
    for (const commitSha of ['808d714', implementationBaselineCommit]) {
      const records = new Map<string, unknown>(resolvedRegistry.records);
      records.set('record:test/doc-001', candidateEvidence('test', commitSha));
      const parsed = parsedLedger([resolvedClosedRow()]);
      const result = validateReadinessLedger(
        parsePlanFindings(plan),
        parsed.findings,
        parsed.exceptions,
        verificationDate,
        uncheckedRegistry(records),
        testScopeManifest,
      );
      expect(result).toContain(
        commitSha.length === 40
          ? 'Registry record entry 3 uses the implementation baseline as a release candidate.'
          : 'Registry record entry 3 has an invalid candidate commit.',
      );
    }
  });

  it('requires terminal test, gate, and decision evidence to name one candidate', () => {
    const records = new Map<string, unknown>(resolvedRegistry.records);
    records.set('record:test/doc-001', candidateEvidence('test'));
    records.set('record:gate/doc-001', candidateEvidence('gate', otherCandidateCommit));
    records.set('record:decision/doc-001', candidateEvidence('decision'));
    const parsed = parsedLedger([resolvedClosedRow()]);
    const result = validateReadinessLedger(
      parsePlanFindings(plan),
      parsed.findings,
      parsed.exceptions,
      verificationDate,
      uncheckedRegistry(records),
      testScopeManifest,
    );
    expect(result).toContain('Finding ID DOC-001 has inconsistent release candidate evidence.');
  });

  it('requires failing-first evidence before implementation and final passing evidence after it', () => {
    const records = new Map<string, unknown>(resolvedRegistry.records);
    records.set('record:implementation/doc-001', {
      kind: 'implementation',
      url: 'https://evidence.example.test/implementation/doc-001',
      observedAt: '2026-08-09T11:00:00.000Z',
    });
    records.set('record:failing-test/doc-001', {
      kind: 'failing-test',
      url: 'https://evidence.example.test/failing-test/doc-001',
      observedAt: '2026-08-09T11:30:00.000Z',
    });
    records.set('record:test/doc-001', candidateEvidence('test'));
    records.set('record:gate/doc-001', candidateEvidence('gate'));
    records.set('record:decision/doc-001', candidateEvidence('decision'));
    const parsed = parsedLedger([
      resolvedClosedRow({
        change: 'test:first=record:failing-test/doc-001;passing=record:test/doc-001',
      }),
    ]);
    const result = validateReadinessLedger(
      parsePlanFindings(plan),
      parsed.findings,
      parsed.exceptions,
      verificationDate,
      uncheckedRegistry(records),
      testScopeManifest,
    );
    expect(result).toContain('Finding ID DOC-001 does not prove failing-first test chronology.');
  });

  it('validates the embedded non-behavioral approver through principal validation', () => {
    const principals: ReadonlyArray<readonly [string, unknown]> = [
      ...validPrincipalSourceEntries(),
      [
        'principal:release-bad',
        {
          kind: 'human',
          role: 'Release maintainer',
          subjectId: 'subject:release-bad',
          assignmentUrl: 'http://example.test/assignments/release-bad',
        },
      ],
    ];
    const parsed = parsedLedger([
      resolvedClosedRow({
        change:
          'test-na:record:non-behavioral/doc-001;justification=record:justification/doc-001;approver=principal:release-bad',
      }),
    ]);
    const result = validateReadinessLedger(
      parsePlanFindings(plan),
      parsed.findings,
      parsed.exceptions,
      verificationDate,
      sourceBackedRegistry(undefined, principals),
      testScopeManifest,
    );
    expect(result).toContain('Registry principal entry 10 has an invalid assignment link.');
  });

  it('validates every authored record entry before constructing lookup maps', () => {
    const secret = 'private-record-key';
    const recordEntries: ReadonlyArray<readonly [string, unknown]> = [
      ...resolvedRegistry.records.entries(),
      [secret, { kind: 'docs', url: 'https://example.test/docs/unused' }],
      ['record:docs/wrong-kind', candidateEvidence('gate')],
      ['record:docs/insecure', { kind: 'docs', url: 'http://example.test/docs/unused' }],
      ['record:test/short-candidate', candidateEvidence('test', 'abc1234')],
      ['record:docs/doc-001', { kind: 'docs', url: 'https://example.test/docs/duplicate' }],
    ];
    const parsed = parsedLedger([resolvedClosedRow()]);
    const result = validateReadinessLedger(
      parsePlanFindings(plan),
      parsed.findings,
      parsed.exceptions,
      verificationDate,
      sourceBackedRegistry(recordEntries),
      testScopeManifest,
    );
    expect(result).toEqual(
      expect.arrayContaining([
        'Registry record entry 11 has an invalid key.',
        'Registry record entry 12 has a namespace that does not match its evidence kind.',
        'Registry record entry 13 has an invalid evidence link.',
        'Registry record entry 14 has an invalid candidate commit.',
        'Registry record entry 15 duplicates an earlier key.',
      ]),
    );
    expect(result.join('\n')).not.toContain(secret);
  });

  it('validates every authored principal and explicit human alias assignment globally', () => {
    const secret = 'private-principal-key';
    const principalEntries: ReadonlyArray<readonly [string, unknown]> = [
      ...validPrincipalSourceEntries(),
      [
        secret,
        {
          kind: 'human',
          role: 'Release maintainer',
          subjectId: 'subject:unused-key',
          assignmentUrl: 'https://example.test/assignments/unused-key',
        },
      ],
      [
        'principal:unused-role',
        {
          kind: 'human',
          role: 'Unknown maintainer',
          subjectId: 'subject:unused-role',
          assignmentUrl: 'https://example.test/assignments/unused-role',
        },
      ],
      [
        'principal:unused-subject',
        {
          kind: 'human',
          role: 'Release maintainer',
          subjectId: 'invalid subject',
          assignmentUrl: 'https://example.test/assignments/unused-subject',
        },
      ],
      [
        'principal:unused-link',
        {
          kind: 'role-alias',
          role: 'Release maintainer',
          assignmentUrl: 'http://example.test/assignments/unused-link',
        },
      ],
      [
        'principal:missing-canonical',
        {
          kind: 'human-alias',
          role: 'Release maintainer',
          canonicalPrincipal: 'principal:does-not-exist',
          assignmentUrl: 'https://example.test/assignments/missing-canonical',
        },
      ],
      [
        'principal:conflicting-alias',
        {
          kind: 'human-alias',
          role: 'Security maintainer',
          canonicalPrincipal: 'principal:release-person',
          assignmentUrl: 'https://example.test/assignments/conflicting-alias',
        },
      ],
      [
        'principal:release-person',
        {
          kind: 'human',
          role: 'Release maintainer',
          subjectId: 'subject:duplicate-key',
          assignmentUrl: 'https://example.test/assignments/duplicate-key',
        },
      ],
    ];
    const parsed = parsedLedger([resolvedClosedRow()]);
    const result = validateReadinessLedger(
      parsePlanFindings(plan),
      parsed.findings,
      parsed.exceptions,
      verificationDate,
      sourceBackedRegistry(undefined, principalEntries),
      testScopeManifest,
    );
    expect(result).toEqual(
      expect.arrayContaining([
        'Registry principal entry 10 has an invalid key.',
        'Registry principal entry 11 has an invalid role.',
        'Registry principal entry 12 has an invalid subject identity.',
        'Registry principal entry 13 has an invalid assignment link.',
        'Registry principal entry 14 has an invalid canonical human assignment.',
        'Registry principal entry 15 conflicts with its canonical human assignment.',
        'Registry principal entry 16 duplicates an earlier key.',
      ]),
    );
    expect(result.join('\n')).not.toContain(secret);
  });

  it('resolves an intentional human alias to its canonical subject', () => {
    const parsed = parsedLedger([
      resolvedClosedRow({
        decision:
          'decision:record:decision/doc-001;implementation=principal:documentation-alias;finding=principal:documentation-person;approver=principal:release-person',
      }),
    ]);
    const result = validateReadinessLedger(
      parsePlanFindings(plan),
      parsed.findings,
      parsed.exceptions,
      verificationDate,
      sourceBackedRegistry(),
      testScopeManifest,
    );
    expect(result).toContain('Finding ID DOC-001 has a decision with non-independent subjects.');
    expect(result).not.toContain('Registry principal entry 6 duplicates a canonical subject.');
  });

  it('type-checks mitigation and non-behavioral embedded records', () => {
    const nonBehavioral = resolvedClosedRow({
      change:
        'test-na:record:mitigation/doc-001;justification=record:docs/doc-001;approver=principal:release-person',
    });
    expect(resolvedErrors([nonBehavioral])).toContain(
      'Finding ID DOC-001 has an evidence type mismatch.',
    );

    const finding = resolvedClosedRow({ status: 'Accepted P1 exception' });
    expect(
      resolvedErrors(
        [finding],
        [
          exceptionRow({
            ownerReference: 'principal:documentation-person',
            mitigation: 'mitigation:record:docs/doc-001',
            residualRisk: 'risk:record:audit/doc-001',
            decision:
              'decision:record:decision/doc-001;implementation=principal:implementation-person;finding=principal:documentation-person;approver=principal:release-person',
            approver: 'approver:principal:release-person',
          }),
        ],
      ),
    ).toContain('P1 exception finding ID DOC-001 has an evidence type mismatch.');
  });

  it('rejects placeholder and whitespace public limitations through resolved validation', () => {
    const finding = resolvedClosedRow({ status: 'Accepted P1 exception' });
    const exception = exceptionRow({
      ownerReference: 'principal:documentation-person',
      mitigation: 'mitigation:record:mitigation/doc-001',
      residualRisk: 'risk:record:audit/doc-001',
      decision:
        'decision:record:decision/doc-001;implementation=principal:implementation-person;finding=principal:documentation-person;approver=principal:release-person',
      approver: 'approver:principal:release-person',
    });
    for (const limitation of ['pending:open', 'not-required', '   ']) {
      expect(
        resolvedErrors(
          [finding],
          [
            exceptionRow({
              ownerReference: 'principal:documentation-person',
              mitigation: 'mitigation:record:mitigation/doc-001',
              limitation,
              residualRisk: 'risk:record:audit/doc-001',
              decision:
                'decision:record:decision/doc-001;implementation=principal:implementation-person;finding=principal:documentation-person;approver=principal:release-person',
              approver: 'approver:principal:release-person',
            }),
          ],
        ),
      ).toContain('P1 exception finding ID DOC-001 has an invalid public limitation.');
    }
    expect(resolvedErrors([finding], [exception])).not.toContain(
      'P1 exception finding ID DOC-001 has an invalid public limitation.',
    );
  });

  it('rejects placeholder tokens and phrases anywhere in normalized public limitations', () => {
    const finding = resolvedClosedRow({ status: 'Accepted P1 exception' });
    for (const limitation of [
      'Migration guidance remains pending after the release.',
      'The operator impact is TBD for self-hosted deployments.',
      'A TODO marker remains in the published limitation.',
      'This placeholder statement describes no concrete constraint.',
      'The compatibility impact is not applicable to this release.',
      'The affected deployment modes are to / be / determined later.',
    ]) {
      expect(
        resolvedErrors(
          [finding],
          [
            exceptionRow({
              ownerReference: 'principal:documentation-person',
              mitigation: 'mitigation:record:mitigation/doc-001',
              limitation,
              residualRisk: 'risk:record:audit/doc-001',
              decision:
                'decision:record:decision/doc-001;implementation=principal:implementation-person;finding=principal:documentation-person;approver=principal:release-person',
              approver: 'approver:principal:release-person',
            }),
          ],
        ),
      ).toContain('P1 exception finding ID DOC-001 has an invalid public limitation.');
    }
  });

  it('accepts a complete resolvable closure and future exception fixture', () => {
    const finding = resolvedClosedRow({ status: 'Accepted P1 exception' });
    const rows = [
      findingRow({
        id: 'SEC-001',
        priority: 'P0',
        ownerRole: 'Security maintainer',
        ownerReference: 'principal:security-owner',
        securityRequired: 'Yes',
        authority: 'pending:open',
      }),
      finding,
      findingRow({
        id: 'CI-002',
        ownerRole: 'Release maintainer',
        ownerReference: 'principal:release-owner',
        securityRequired: 'Yes',
        authority: 'pending:open',
      }),
    ];
    expect(
      resolvedErrors(rows, [
        exceptionRow({
          ownerReference: 'principal:documentation-person',
          mitigation: 'mitigation:record:mitigation/doc-001',
          residualRisk: 'risk:record:audit/doc-001',
          decision:
            'decision:record:decision/doc-001;implementation=principal:implementation-person;finding=principal:documentation-person;approver=principal:release-person',
          approver: 'approver:principal:release-person',
        }),
      ]),
    ).toEqual([]);
  });

  it('applies CommonMark fence opener and closer rules', () => {
    const invalidBacktickOpener = [
      plan,
      '```lang`bad',
      '| ROGUE-999 | P0 | Visible | Audit | Outcome |',
      '```',
    ].join('\n');
    expect(() => parsePlanFindings(invalidBacktickOpener)).toThrow(
      'outside the selected plan findings table',
    );

    const trailingTextDoesNotClose = [
      plan,
      '````md',
      '```` still fenced',
      '| ROGUE-999 | P0 | Example | Audit | Outcome |',
      '````',
    ].join('\n');
    expect(() => parsePlanFindings(trailingTextDoesNotClose)).not.toThrow();

    const shorterRunDoesNotClose = [
      plan,
      '``````md',
      '`````',
      '| ROGUE-999 | P0 | Example | Audit | Outcome |',
      '``````',
    ].join('\n');
    expect(() => parsePlanFindings(shorterRunDoesNotClose)).not.toThrow();
  });

  it('normalizes full CRLF and bare CR Markdown before parsing', () => {
    expect(parsePlanFindings(plan.replaceAll('\n', '\r\n'))).toHaveLength(3);
    expect(parsePlanFindings(plan.replaceAll('\n', '\r'))).toHaveLength(3);
    const document = ledger([findingRow()]);
    expect(parseFindingRows(document.replaceAll('\n', '\r\n'))).toHaveLength(1);
    expect(parseFindingRows(document.replaceAll('\n', '\r'))).toHaveLength(1);
  });

  it('rejects visible same-width plan rows after a mixed-EOL long fence', () => {
    const secret = 'private-plan-id';
    const document = [
      plan.replaceAll('\n', '\r\n'),
      '``````md\r\n',
      '`````\n',
      `| ${secret} | P0 | Hidden example | Audit | Outcome |\r\n`,
      '``````\r',
      `| ${secret} | P0 | Visible stray | Audit | Outcome |`,
    ].join('');
    expect(() => parsePlanFindings(document)).toThrow(
      'Plan-shaped row is outside the selected plan findings table.',
    );
    try {
      parsePlanFindings(document);
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it('rejects malformed-ID same-width finding and exception rows outside their tables', () => {
    const secret = 'private-malformed-id';
    const findingStray = findingRow({ id: secret, priority: 'private-priority' });
    const exceptionStray = exceptionRow({ id: secret });
    expect(() =>
      parseFindingRows(`${ledger([findingRow()])}\n## Notes\n\n${findingStray}`),
    ).toThrow('Finding-shaped row is outside the selected findings table.');
    expect(() =>
      parseExceptionRows(`${ledger([findingRow()])}\n## Notes\n\n${exceptionStray}`),
    ).toThrow('Exception-shaped row is outside the selected P1 exceptions table.');
  });

  it('rejects exception-shaped rows outside the exception register', () => {
    const stray = `${ledger([findingRow()])}\n## Notes\n\n${exceptionRow()}`;
    expect(() => parseExceptionRows(stray)).toThrow(
      'Exception-shaped row is outside the selected P1 exceptions table.',
    );
    const malformedStray = `${ledger([findingRow()])}\n## Notes\n\n${exceptionRow({ expiry: 'not-a-date' })}`;
    expect(() => parseExceptionRows(malformedStray)).toThrow(
      'Exception-shaped row is outside the selected P1 exceptions table.',
    );
  });

  it('ignores tilde and long backtick fences and double-backtick code spans', () => {
    const fenced = `${plan}\n~~~~\n| ROGUE-999 | P0 | Example | Audit | Outcome |\n~~~~\n\`\`a|b\`\``;
    expect(() => parsePlanFindings(fenced)).not.toThrow();
    expect(() =>
      parseFindingRows(ledger([findingRow({ finding: 'A ``a|b`` value' })])),
    ).not.toThrow();
  });
  it('accepts exact section-scoped plan findings and structured open controls', () => {
    const rows = [
      findingRow({
        id: 'SEC-001',
        priority: 'P0',
        finding: 'Security finding with `a|b`',
        ownerRole: 'Security maintainer',
        ownerReference: 'principal:security-owner',
        securityRequired: 'Yes',
        authority: 'pending:open',
        residualRisk: 'risk:record:audit/f1bfdc3',
      }),
      findingRow({ residualRisk: 'risk:record:audit/f1bfdc3' }),
      findingRow({
        id: 'CI-002',
        finding: 'Supply chain finding',
        ownerRole: 'Release maintainer',
        ownerReference: 'principal:release-owner',
        securityRequired: 'Yes',
        authority: 'pending:open',
        residualRisk: 'risk:record:audit/f1bfdc3',
      }),
    ];
    expect(errors(rows)).toEqual([]);
  });

  it('rejects unscoped, duplicate, split, and rogue finding tables while ignoring fenced examples', () => {
    expect(() => parsePlanFindings(`${plan}\n| ROGUE-999 | P0 | Rogue |`)).toThrow(
      'outside the selected plan findings table',
    );
    expect(() =>
      parsePlanFindings(`${plan}\n## Notes\n\n\`\`\`md\n| ROGUE-999 | P0 | Example |\n\`\`\``),
    ).not.toThrow();
    expect(() =>
      parseFindingRows(
        `${ledger([findingRow()])}\n${findingHeader}\n${findingSeparator}\n${findingRow()}`,
      ),
    ).toThrow('duplicate findings table');
    expect(() => parseFindingRows(ledger([findingRow(), '', findingRow()]))).toThrow(
      'outside the selected findings table',
    );
    expect(() =>
      parseFindingRows(ledger([findingRow()]).replace(findingSeparator, '| bad | separator |')),
    ).toThrow('separator');
  });

  it('rejects plain text records, placeholders, and missing ready-for-closure evidence', () => {
    const row = findingRow({
      status: 'Ready for closure',
      implementation: 'plain implementation',
      change: 'Not applicable',
      releaseGate: 'plain gate',
      documentation: 'pending:open',
      residualRisk: 'Not applicable',
    });
    const result = errors([row]);
    expect(result).toContain('Finding ID DOC-001 has invalid implementation evidence.');
    expect(result).toContain('Finding ID DOC-001 has invalid change evidence.');
    expect(result).toContain('Finding ID DOC-001 has invalid release-gate evidence.');
    expect(result).toContain('Finding ID DOC-001 has invalid documentation evidence.');
    expect(result).toContain('Finding ID DOC-001 has invalid residual-risk record.');
  });

  it('requires an exact decision attestation and distinct principal references', () => {
    const row = findingRow({
      status: 'Closed',
      implementation: 'implementation:record:pull/123',
      change: 'test:record:test/doc-001',
      releaseGate: 'gate:record:ci/doc-001',
      documentation: 'docs:record:docs/doc-001',
      decision:
        'decision:record:release/doc-001;implementation=principal:documentation-owner;finding=principal:documentation-owner;approver=principal:documentation-owner',
      approver: 'approver:principal:documentation-owner',
    });
    expect(errors([row])).toContain(
      'Finding ID DOC-001 has a decision with non-independent principals.',
    );
  });

  it('enforces explicit security authority applicability including non-SEC findings', () => {
    const rows = [
      findingRow({
        id: 'SEC-001',
        priority: 'P0',
        finding: 'Security finding',
        ownerRole: 'Security maintainer',
        ownerReference: 'principal:security-owner',
        securityRequired: 'Yes',
        status: 'Closed',
        implementation: 'implementation:record:pull/1',
        change: 'test:record:test/sec',
        releaseGate: 'gate:record:ci/sec',
        documentation: 'docs:record:docs/sec',
        decision:
          'decision:record:release/sec;implementation=principal:impl-a;finding=principal:security-owner;approver=principal:release-a',
        approver: 'approver:principal:release-a',
        authority: 'not-required',
      }),
      findingRow({
        id: 'DOC-001',
        securityRequired: 'No',
        authority: 'authority:principal:security-a',
      }),
      findingRow({
        id: 'CI-002',
        finding: 'Supply chain finding',
        ownerRole: 'Release maintainer',
        ownerReference: 'principal:release-owner',
        securityRequired: 'Yes',
        status: 'Closed',
        implementation: 'implementation:record:pull/2',
        change: 'test:record:test/ci',
        releaseGate: 'gate:record:ci/ci',
        documentation: 'docs:record:docs/ci',
        decision:
          'decision:record:release/ci;implementation=principal:impl-b;finding=principal:release-owner;approver=principal:release-a',
        approver: 'approver:principal:release-a',
        authority: 'not-required',
      }),
    ];
    const result = errors(rows);
    expect(result).toContain('Finding ID SEC-001 is missing security authority record.');
    expect(result).toContain(
      'Finding ID DOC-001 has invalid security authority record for Open status.',
    );
    expect(result).toContain('Finding ID CI-002 is missing security authority record.');
  });

  it('rejects expired, today, impossible, mismatched, duplicate, and self-approved exceptions', () => {
    const finding = findingRow({
      status: 'Accepted P1 exception',
      implementation: 'implementation:record:pull/123',
      change: 'test:record:test/doc-001',
      releaseGate: 'gate:record:ci/doc-001',
      documentation: 'docs:record:docs/doc-001',
      decision:
        'decision:record:release/doc-001;implementation=principal:writer-a;finding=principal:documentation-owner;approver=principal:release-a',
      approver: 'approver:principal:release-a',
    });
    const exceptions = [
      exceptionRow({ expiry: '2026-08-09', approver: 'approver:principal:documentation-owner' }),
      exceptionRow({
        expiry: '2026-99-99',
        decision:
          'decision:record:release/other;implementation=principal:writer-a;finding=principal:documentation-owner;approver=principal:release-a',
      }),
    ];
    expect(errors([finding], exceptions)).toEqual(
      expect.arrayContaining([
        'P1 exception row 3 has an expiry date that is not after the verification date.',
        'P1 exception row 4 has an invalid expiry date.',
        'Duplicate P1 exception finding ID: DOC-001.',
        'P1 exception finding ID DOC-001 has a decision record mismatch.',
        'P1 exception finding ID DOC-001 has a non-independent approver.',
      ]),
    );
  });

  it('requires exact Security maintainer authority on an accepted security exception', () => {
    const finding = resolvedClosedRow({
      status: 'Accepted P1 exception',
      securityRequired: 'Yes',
      authority: 'authority:principal:data-person',
    });
    const rows = [
      findingRow({
        id: 'SEC-001',
        priority: 'P0',
        finding: 'Security finding',
        ownerRole: 'Security maintainer',
        ownerReference: 'principal:security-owner',
        securityRequired: 'Yes',
        authority: 'pending:open',
        residualRisk: 'risk:record:audit/doc-001',
      }),
      finding,
      findingRow({
        id: 'CI-002',
        finding: 'Supply chain finding',
        ownerRole: 'Release maintainer',
        ownerReference: 'principal:release-owner',
        securityRequired: 'Yes',
        authority: 'pending:open',
        residualRisk: 'risk:record:audit/doc-001',
      }),
    ];
    expect(
      resolvedErrors(rows, [
        exceptionRow({
          ownerReference: 'principal:documentation-person',
          mitigation: 'mitigation:record:mitigation/doc-001',
          residualRisk: 'risk:record:audit/doc-001',
          decision:
            'decision:record:decision/doc-001;implementation=principal:implementation-person;finding=principal:documentation-person;approver=principal:release-person',
          approver: 'approver:principal:release-person',
          authority: 'authority:principal:data-person',
        }),
      ]),
    ).toContain(
      'P1 exception finding ID DOC-001 has security authority without Security maintainer authority.',
    );
  });

  it('redacts malformed identifiers in validation and parser diagnostics', () => {
    const secret = 'private-token-marker';
    const malformed = findingRow({ id: secret });
    const result = errors([malformed]);
    expect(result.join('\n')).not.toContain(secret);
    expect(result).toContain('Finding row 3 has an invalid ID.');
    expect(() =>
      parseExceptionRows(ledger([findingRow()], [exceptionRow({ id: secret })])),
    ).not.toThrow();
    expect(errors([findingRow()], [exceptionRow({ id: secret })]).join('\n')).not.toContain(secret);
  });
});
