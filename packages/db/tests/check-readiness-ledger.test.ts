import { describe, expect, it } from 'bun:test';
import {
  parseExceptionRows,
  parseFindingRows,
  parsePlanFindings,
  validateReadinessLedger,
} from '../../../scripts/check-readiness-ledger.ts';

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
  );
}

describe('readiness ledger checker', () => {
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
      }),
      findingRow(),
      findingRow({
        id: 'CI-002',
        finding: 'Supply chain finding',
        ownerRole: 'Release maintainer',
        ownerReference: 'principal:release-owner',
        securityRequired: 'Yes',
        authority: 'pending:open',
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

  it('accepts a complete future exception with matching structured records', () => {
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
    const rows = [
      findingRow({
        id: 'SEC-001',
        priority: 'P0',
        finding: 'Security finding',
        ownerRole: 'Security maintainer',
        ownerReference: 'principal:security-owner',
        securityRequired: 'Yes',
        authority: 'pending:open',
      }),
      finding,
      findingRow({
        id: 'CI-002',
        finding: 'Supply chain finding',
        ownerRole: 'Release maintainer',
        ownerReference: 'principal:release-owner',
        securityRequired: 'Yes',
        authority: 'pending:open',
      }),
    ];
    expect(errors(rows, [exceptionRow()])).toEqual([]);
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
