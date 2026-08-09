export type ReadinessPriority = 'P0' | 'P1';

export interface AuditedScopeFinding {
  readonly id: string;
  readonly priority: ReadinessPriority;
}

export interface ReadinessScopeManifest {
  readonly version: string;
  readonly digest: string;
  readonly findings: readonly AuditedScopeFinding[];
}

export const readinessScopeManifest: ReadinessScopeManifest = {
  version: 'readiness-scope/2026-08-09-v1',
  digest: 'sha256:2795b5e40961a7607fc0d34cad098fd77a41cf38e457a3a2f1cf8fd99f50a74c',
  findings: [
    { id: 'CFG-001', priority: 'P1' },
    { id: 'CI-001', priority: 'P0' },
    { id: 'CI-002', priority: 'P1' },
    { id: 'DB-001', priority: 'P0' },
    { id: 'DB-002', priority: 'P0' },
    { id: 'DEP-001', priority: 'P0' },
    { id: 'DEP-002', priority: 'P0' },
    { id: 'DEP-003', priority: 'P0' },
    { id: 'DEP-004', priority: 'P0' },
    { id: 'DEP-005', priority: 'P1' },
    { id: 'DEP-006', priority: 'P1' },
    { id: 'DEP-007', priority: 'P1' },
    { id: 'DOC-001', priority: 'P1' },
    { id: 'EXP-001', priority: 'P1' },
    { id: 'INT-001', priority: 'P0' },
    { id: 'MCP-001', priority: 'P1' },
    { id: 'PORT-001', priority: 'P0' },
    { id: 'PRIV-001', priority: 'P0' },
    { id: 'PRIV-002', priority: 'P1' },
    { id: 'REL-001', priority: 'P1' },
    { id: 'REL-002', priority: 'P1' },
    { id: 'REPO-001', priority: 'P1' },
    { id: 'RT-001', priority: 'P0' },
    { id: 'SEC-001', priority: 'P0' },
    { id: 'SEC-002', priority: 'P0' },
    { id: 'SEC-003', priority: 'P0' },
    { id: 'SEC-004', priority: 'P0' },
    { id: 'SEC-005', priority: 'P0' },
    { id: 'SEC-006', priority: 'P0' },
    { id: 'SEC-007', priority: 'P1' },
    { id: 'SEC-008', priority: 'P1' },
    { id: 'SEC-009', priority: 'P1' },
    { id: 'SEC-010', priority: 'P1' },
    { id: 'SEC-011', priority: 'P1' },
    { id: 'SEC-012', priority: 'P1' },
    { id: 'SEC-013', priority: 'P1' },
    { id: 'SEC-014', priority: 'P1' },
    { id: 'SEC-015', priority: 'P1' },
    { id: 'SEC-016', priority: 'P1' },
    { id: 'SEC-017', priority: 'P1' },
    { id: 'TEN-001', priority: 'P0' },
  ],
};
