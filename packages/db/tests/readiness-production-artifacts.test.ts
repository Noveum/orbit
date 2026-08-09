import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  currentUtcDate,
  parseExceptionRows,
  parseFindingRows,
  parsePlanFindings,
  validateReadinessLedger,
} from '../../../scripts/check-readiness-ledger.ts';
import { createProductionReadinessEvidenceVerifier } from '../../../scripts/readiness-evidence-verifier.ts';
import { readinessReferenceRegistrySource } from '../../../scripts/readiness-reference-registry.ts';
import { readinessScopeManifest } from '../../../scripts/readiness-scope-manifest.ts';

const INITIAL_SCOPE_VERSION = 'readiness-scope/2026-08-09-v1';

describe('production readiness artifacts', () => {
  it('validates the committed artifacts and the initial 41-row scope', async () => {
    const root = resolve(import.meta.dir, '../../..');
    const [planText, ledgerText] = await Promise.all([
      readFile(resolve(root, 'docs/superpowers/plans/2026-08-09-open-source-readiness.md'), 'utf8'),
      readFile(resolve(root, 'docs/maintainers/readiness-ledger.md'), 'utf8'),
    ]);
    const plan = parsePlanFindings(planText);
    const findings = parseFindingRows(ledgerText);
    const verifier = await createProductionReadinessEvidenceVerifier(
      root,
      readinessReferenceRegistrySource,
    );
    const errors = validateReadinessLedger(
      plan,
      findings,
      parseExceptionRows(ledgerText),
      currentUtcDate(new Date(verifier.verificationInstant)),
      readinessReferenceRegistrySource,
      readinessScopeManifest,
      verifier,
    );
    expect(errors).toEqual([]);
    expect(findings).toHaveLength(readinessScopeManifest.findings.length);
    expect(findings.filter((finding) => finding.priority === 'P0')).toHaveLength(
      readinessScopeManifest.findings.filter((finding) => finding.priority === 'P0').length,
    );
    expect(findings.filter((finding) => finding.priority === 'P1')).toHaveLength(
      readinessScopeManifest.findings.filter((finding) => finding.priority === 'P1').length,
    );
    if (readinessScopeManifest.version === INITIAL_SCOPE_VERSION) {
      expect(findings).toHaveLength(41);
      expect(findings.filter((finding) => finding.priority === 'P0')).toHaveLength(18);
      expect(findings.filter((finding) => finding.priority === 'P1')).toHaveLength(23);
      expect(findings.some((finding) => finding.id === 'SEC-018')).toBe(false);
    }
    expect(verifier.commitExists(verifier.currentCommit)).toBe(true);
  });

  it('keeps authenticated readiness validation in trusted-base workflow code', async () => {
    const root = resolve(import.meta.dir, '../../..');
    const [ci, scopePolicy, scopeChecker] = await Promise.all([
      readFile(resolve(root, '.github/workflows/ci.yml'), 'utf8'),
      readFile(resolve(root, '.github/workflows/readiness-scope.yml'), 'utf8'),
      readFile(resolve(root, 'scripts/check-readiness-scope-pr.ts'), 'utf8'),
    ]);
    const staticJob = ci.slice(ci.indexOf('  static:'), ci.indexOf('  readiness-hosted:'));
    const expression = '$';
    expect(staticJob).not.toContain('actions: read');
    expect(staticJob).not.toContain('GITHUB_TOKEN:');
    expect(scopePolicy).toContain('pull_request_target:');
    expect(scopePolicy).toContain('actions: read');
    expect(scopePolicy).toContain('statuses: write');
    expect(scopePolicy).toContain('persist-credentials: false');
    expect(scopeChecker).toContain("context: 'Trusted readiness policy'");
    expect(ci).toContain(
      `name: readiness-test-${expression}{{ github.event.pull_request.head.sha || github.sha }}-${expression}{{ github.run_attempt }}`,
    );
    expect(ci).toContain('name: Readiness release gate');
    expect(ci).toContain('needs: [static, test, schema, build, e2e]');
    expect(ci).toContain(
      `name: readiness-gate-${expression}{{ github.sha }}-${expression}{{ github.run_attempt }}`,
    );
    expect(
      ci.match(/actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/g),
    ).toHaveLength(2);
  });
});
