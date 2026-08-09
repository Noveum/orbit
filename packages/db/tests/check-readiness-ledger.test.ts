import { describe, expect, it } from 'bun:test';
import {
  parseExceptionRows,
  parseFindingRows,
  parsePlanFindings,
  validateReadinessLedger,
} from '../../../scripts/check-readiness-ledger.ts';

const plan = `
| ID | Priority | Finding |
| --- | --- | --- |
| SEC-001 | P0 | Security finding |
| DOC-001 | P1 | Documentation finding |
`;

const ledger = `
| ID | Priority | Finding | Accountable owner role | Status | Pull request or branch | Evidence | Objective close condition | Residual risk | Decision record | Independent approver | Security authority record |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-001 | P0 | Security finding | Security maintainer | Open | None | Audit | Tested outcome | Open risk | Not applicable while Open | Not applicable while Open | Not applicable while Open |
| DOC-001 | P1 | Documentation finding | Documentation maintainer | Open | None | Audit | Tested outcome | Open risk | Not applicable while Open | Not applicable while Open | Not applicable |

| Finding ID | Accountable owner | Expiry date | Mitigation | Public limitation | Residual risk | Decision record | Independent approver | Security authority record |
| --- | --- | --- | --- | --- | --- | --- | --- |
`;

describe('readiness ledger checker', () => {
  it('accepts a complete matching ledger with no accepted exceptions', () => {
    expect(
      validateReadinessLedger(
        parsePlanFindings(plan),
        parseFindingRows(ledger),
        parseExceptionRows(ledger),
      ),
    ).toEqual([]);
  });

  it('rejects a priority mismatch by finding ID without echoing row content', () => {
    const rows = parseFindingRows(ledger).map((row) =>
      row.id === 'DOC-001' ? { ...row, priority: 'P0' } : row,
    );

    expect(
      validateReadinessLedger(parsePlanFindings(plan), rows, parseExceptionRows(ledger)),
    ).toContain('Priority mismatch for finding ID DOC-001.');
  });

  it('rejects a closed finding without a release decision and independent approver', () => {
    const rows = parseFindingRows(ledger).map((row) =>
      row.id === 'DOC-001'
        ? {
            ...row,
            status: 'Closed',
          }
        : row,
    );

    expect(
      validateReadinessLedger(parsePlanFindings(plan), rows, parseExceptionRows(ledger)),
    ).toEqual(
      expect.arrayContaining([
        'Finding ID DOC-001 is missing decision record for status Closed.',
        'Finding ID DOC-001 is missing independent approver for status Closed.',
      ]),
    );
  });

  it('requires a terminal approver to be identified as a Release maintainer', () => {
    const rows = parseFindingRows(ledger).map((row) =>
      row.id === 'DOC-001'
        ? {
            ...row,
            status: 'Closed',
            decisionRecord: 'Release record R-004',
            independentApprover: 'Approver in R-004',
          }
        : row,
    );

    expect(
      validateReadinessLedger(parsePlanFindings(plan), rows, parseExceptionRows(ledger)),
    ).toContain(
      'Finding ID DOC-001 has an approver that is not identified as a Release maintainer.',
    );
  });

  it('rejects an accepted P0 exception and an accepted P1 without an exception record', () => {
    const rows = parseFindingRows(ledger).map((row) => {
      if (row.id === 'SEC-001') return { ...row, status: 'Accepted P1 exception' };
      if (row.id === 'DOC-001') {
        return {
          ...row,
          status: 'Accepted P1 exception',
          decisionRecord: 'Release record R-001',
          independentApprover: 'Named Release maintainer in R-001',
        };
      }
      return row;
    });

    expect(
      validateReadinessLedger(parsePlanFindings(plan), rows, parseExceptionRows(ledger)),
    ).toEqual(
      expect.arrayContaining([
        'Finding ID SEC-001 is P0 and cannot use Accepted P1 exception.',
        'Finding ID DOC-001 has no P1 exception record.',
      ]),
    );
  });

  it('requires a security authority record when a security finding closes', () => {
    const rows = parseFindingRows(ledger).map((row) =>
      row.id === 'SEC-001'
        ? {
            ...row,
            status: 'Closed',
            decisionRecord: 'Release record R-002',
            independentApprover: 'Named Release maintainer in R-002',
          }
        : row,
    );

    expect(
      validateReadinessLedger(parsePlanFindings(plan), rows, parseExceptionRows(ledger)),
    ).toContain('Finding ID SEC-001 is missing security authority record for status Closed.');
  });

  it('requires every P1 exception field and accepts a complete approved exception', () => {
    const rows = parseFindingRows(ledger).map((row) =>
      row.id === 'DOC-001'
        ? {
            ...row,
            status: 'Accepted P1 exception',
            decisionRecord: 'Release record R-003',
            independentApprover: 'Named Release maintainer in R-003',
          }
        : row,
    );
    const exceptions = parseExceptionRows(`
| Finding ID | Accountable owner | Expiry date | Mitigation | Public limitation | Residual risk | Decision record | Independent approver | Security authority record |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DOC-001 | Named owner in R-003 | 2027-01-01 | Temporary mitigation | Public limitation | Remaining risk | Release record R-003 | Named Release maintainer in R-003 | Not applicable |
`);

    expect(validateReadinessLedger(parsePlanFindings(plan), rows, exceptions)).toEqual([]);
  });
});
