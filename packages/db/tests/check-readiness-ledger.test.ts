import { describe, expect, it } from 'bun:test';
import {
  currentUtcDate,
  parseExceptionRows,
  parseFindingRows,
  parsePlanFindings,
  validateReadinessLedger,
} from '../../../scripts/check-readiness-ledger.ts';
import {
  type ReadinessReferenceRegistry,
  readinessReferenceRegistry,
} from '../../../scripts/readiness-reference-registry.ts';

const verificationDate = '2026-08-09';

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
  records: new Map([
    ['record:audit/doc-001', { kind: 'audit-risk', url: 'https://example.test/audit/doc-001' }],
    [
      'record:implementation/doc-001',
      {
        kind: 'implementation',
        url: 'https://example.test/implementation/doc-001',
        releaseCommit: '808d714',
      },
    ],
    [
      'record:test/doc-001',
      { kind: 'test', url: 'https://example.test/test/doc-001', releaseCommit: '808d714' },
    ],
    [
      'record:gate/doc-001',
      { kind: 'gate', url: 'https://example.test/gate/doc-001', releaseCommit: '808d714' },
    ],
    ['record:docs/doc-001', { kind: 'docs', url: 'https://example.test/docs/doc-001' }],
    [
      'record:decision/doc-001',
      { kind: 'decision', url: 'https://example.test/decision/doc-001', releaseCommit: '808d714' },
    ],
    [
      'record:mitigation/doc-001',
      { kind: 'mitigation', url: 'https://example.test/mitigation/doc-001' },
    ],
    [
      'record:non-behavioral/doc-001',
      {
        kind: 'non-behavioral',
        url: 'https://example.test/non-behavioral/doc-001',
        releaseCommit: '808d714',
      },
    ],
    [
      'record:justification/doc-001',
      { kind: 'justification', url: 'https://example.test/justification/doc-001' },
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
    readinessReferenceRegistry,
  );
}

function resolvedErrors(rows: readonly string[], exceptions: readonly string[] = []): string[] {
  const parsed = parsedLedger(rows, exceptions);
  return validateReadinessLedger(
    parsePlanFindings(plan),
    parsed.findings,
    parsed.exceptions,
    verificationDate,
    resolvedRegistry,
  );
}

function resolvedClosedRow(overrides: Readonly<Record<string, string>> = {}): string {
  return findingRow({
    ownerReference: 'principal:documentation-person',
    status: 'Closed',
    implementation: 'implementation:record:implementation/doc-001',
    change: 'test:record:test/doc-001',
    releaseGate: 'gate:record:gate/doc-001',
    documentation: 'docs:record:docs/doc-001',
    decision:
      'decision:record:decision/doc-001;implementation=principal:implementation-person;finding=principal:documentation-person;approver=principal:release-person',
    approver: 'approver:principal:release-person',
    ...overrides,
  });
}

describe('readiness ledger checker', () => {
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
        readinessReferenceRegistry,
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
      readinessReferenceRegistry,
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
        {
          ...resolvedRegistry,
          principals: invalidPrincipals,
        },
      ),
    ).toContain('Finding ID DOC-001 has an invalid principal assignment link.');

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
        {
          ...resolvedRegistry,
          principals: invalidSubjectPrincipals,
        },
      ),
    ).toContain('Finding ID DOC-001 has an invalid principal subject identity.');
  });

  it('requires every evidence field to resolve to its exact type and selected release', () => {
    const wrongCategoryRows = [
      resolvedClosedRow({ implementation: 'implementation:record:test/doc-001' }),
      resolvedClosedRow({ change: 'test:record:implementation/doc-001' }),
      resolvedClosedRow({ releaseGate: 'gate:record:test/doc-001' }),
      resolvedClosedRow({ documentation: 'docs:record:gate/doc-001' }),
      resolvedClosedRow({ residualRisk: 'risk:record:docs/doc-001' }),
      resolvedClosedRow({
        decision:
          'decision:record:audit/doc-001;implementation=principal:implementation-person;finding=principal:documentation-person;approver=principal:release-person',
      }),
      resolvedClosedRow({ implementation: 'implementation:record:audit/doc-001' }),
      resolvedClosedRow({ change: 'test:record:audit/doc-001' }),
      resolvedClosedRow({ releaseGate: 'gate:record:audit/doc-001' }),
      resolvedClosedRow({ documentation: 'docs:record:audit/doc-001' }),
    ];
    for (const row of wrongCategoryRows) {
      expect(resolvedErrors([row])).toContain('Finding ID DOC-001 has an evidence type mismatch.');
    }

    const staleRecords = new Map(resolvedRegistry.records);
    staleRecords.set('record:test/doc-001', {
      kind: 'test',
      url: 'https://example.test/test/doc-001',
      releaseCommit: 'stale123',
    });
    const parsed = parsedLedger([resolvedClosedRow()]);
    expect(
      validateReadinessLedger(
        parsePlanFindings(plan),
        parsed.findings,
        parsed.exceptions,
        verificationDate,
        {
          ...resolvedRegistry,
          records: staleRecords,
        },
      ),
    ).toContain('Finding ID DOC-001 has release evidence for the wrong commit.');

    const invalidLinkRecords = new Map(resolvedRegistry.records);
    invalidLinkRecords.set('record:test/doc-001', {
      kind: 'test',
      url: 'http://example.test/test/doc-001',
      releaseCommit: '808d714',
    });
    expect(
      validateReadinessLedger(
        parsePlanFindings(plan),
        parsed.findings,
        parsed.exceptions,
        verificationDate,
        {
          ...resolvedRegistry,
          records: invalidLinkRecords,
        },
      ),
    ).toContain('Finding ID DOC-001 has an invalid evidence link.');

    const staleGateRecords = new Map(resolvedRegistry.records);
    staleGateRecords.set('record:gate/doc-001', {
      kind: 'gate',
      url: 'https://example.test/gate/doc-001',
      releaseCommit: 'stale123',
    });
    expect(
      validateReadinessLedger(
        parsePlanFindings(plan),
        parsed.findings,
        parsed.exceptions,
        verificationDate,
        {
          ...resolvedRegistry,
          records: staleGateRecords,
        },
      ),
    ).toContain('Finding ID DOC-001 has release evidence for the wrong commit.');

    const mislabeledRecords = new Map(resolvedRegistry.records);
    mislabeledRecords.set('record:audit/mislabeled', {
      kind: 'implementation',
      url: 'https://example.test/implementation/mislabeled',
      releaseCommit: '808d714',
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
        {
          ...resolvedRegistry,
          records: mislabeledRecords,
        },
      ),
    ).toContain('Finding ID DOC-001 has an evidence type mismatch.');
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
