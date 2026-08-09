import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  type ReadinessScopePrInput,
  validateReadinessScopePullRequest,
} from '../../../scripts/check-readiness-scope-pr.ts';
import {
  computeReadinessScopeDigest,
  computeReadinessTextDigest,
  type ReadinessScopeManifest,
} from '../../../scripts/readiness-scope-manifest.ts';

const baseSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const headSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const allowedFiles = [
  'docs/maintainers/readiness-ledger.md',
  'docs/maintainers/readiness-scope-audit.json',
  'docs/superpowers/plans/2026-08-09-open-source-readiness.md',
  'scripts/readiness-scope-manifest.json',
] as const;

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
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
`;
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
  return JSON.stringify({
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
    baseSha,
    headSha,
    changedFiles: [...allowedFiles],
    base: {
      plan: plan('Original risk', 'Original outcome'),
      ledger: ledger('Original risk', 'Original outcome'),
      manifest: baseManifest,
      audit: '{}',
      registry: '{"recordEntries":[],"principalEntries":[]}',
    },
    head: {
      plan: plan('Canonical risk', 'Canonical outcome'),
      ledger: ledger('Canonical risk', 'Canonical outcome'),
      manifest: headManifest,
      audit: JSON.stringify({
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
      registry: '{"recordEntries":[],"principalEntries":[]}',
    },
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
    return JSON.stringify({
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
      audit: JSON.stringify({
        ...audit,
        baseDigest: (JSON.parse(baseManifest) as ReadinessScopeManifest).digest,
        headDigest: (JSON.parse(headManifest) as ReadinessScopeManifest).digest,
      }),
    },
  };
}

describe('readiness scope pull request policy', () => {
  it('accepts a dedicated, audited, dual-approved exact-head scope change', () => {
    expect(validateReadinessScopePullRequest(fixture())).toEqual([]);
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

  it('requires exact ledger and registry changes for a closure transition', () => {
    const input = fixture();
    const base = {
      ...input.base,
      ledger: ledger('Original risk', 'Original outcome', 'Ready for closure'),
    };
    const head = {
      ...base,
      ledger: ledger('Original risk', 'Original outcome', 'Closed'),
      registry: '{"recordEntries":[["record:closure/doc-001",{}]],"principalEntries":[]}',
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
        reviews: [],
      }),
    ).toContain('Closure transitions must use the exact ledger-and-registry file shape.');
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
});
