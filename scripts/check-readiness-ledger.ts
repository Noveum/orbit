import { readFile } from 'node:fs/promises';

const OWNER_ROLES = new Set([
  'Security maintainer',
  'Data maintainer',
  'Platform maintainer',
  'Realtime maintainer',
  'Integrations maintainer',
  'Release maintainer',
  'Documentation maintainer',
  'Repository maintainer',
]);

const STATUSES = new Set([
  'Open',
  'In progress',
  'Ready for closure',
  'Closed',
  'Accepted P1 exception',
]);

const FINDING_HEADER = [
  'ID',
  'Priority',
  'Finding',
  'Accountable owner role',
  'Status',
  'Pull request or branch',
  'Evidence',
  'Objective close condition',
  'Residual risk',
  'Decision record',
  'Independent approver',
  'Security authority record',
];

const EXCEPTION_HEADER = [
  'Finding ID',
  'Accountable owner',
  'Expiry date',
  'Mitigation',
  'Public limitation',
  'Residual risk',
  'Decision record',
  'Independent approver',
  'Security authority record',
];

const SECURITY_SENSITIVE_IDS = new Set([
  'RT-001',
  'TEN-001',
  'PRIV-001',
  'PRIV-002',
  'INT-001',
  'MCP-001',
]);

export interface PlanFinding {
  readonly id: string;
  readonly priority: string;
}

export interface FindingRow {
  readonly id: string;
  readonly priority: string;
  readonly finding: string;
  readonly ownerRole: string;
  readonly status: string;
  readonly pullRequestOrBranch: string;
  readonly evidence: string;
  readonly closeCondition: string;
  readonly residualRisk: string;
  readonly decisionRecord: string;
  readonly independentApprover: string;
  readonly securityAuthorityRecord: string;
}

export interface ExceptionRow {
  readonly findingId: string;
  readonly accountableOwner: string;
  readonly expiryDate: string;
  readonly mitigation: string;
  readonly publicLimitation: string;
  readonly residualRisk: string;
  readonly decisionRecord: string;
  readonly independentApprover: string;
  readonly securityAuthorityRecord: string;
}

function tableCells(line: string): string[] {
  return line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function headerLine(header: readonly string[]): string {
  return `| ${header.join(' | ')} |`;
}

function rowsUnderHeader(text: string, header: readonly string[], label: string): string[][] {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === headerLine(header));
  if (start === -1) throw new Error(`${label} table schema is missing or invalid.`);
  const rows: string[][] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    const cells = tableCells(line);
    if (cells.length !== header.length) throw new Error(`${label} table has an invalid row shape.`);
    rows.push(cells);
  }
  return rows;
}

export function parsePlanFindings(text: string): PlanFinding[] {
  const findings: PlanFinding[] = [];
  for (const match of text.matchAll(/^\|\s*([A-Z]+-\d+)\s*\|\s*(P[01])\s*\|/gm)) {
    const id = match[1];
    const priority = match[2];
    if (id === undefined || priority === undefined) continue;
    findings.push({ id, priority });
  }
  return findings;
}

export function parseFindingRows(text: string): FindingRow[] {
  return rowsUnderHeader(text, FINDING_HEADER, 'Readiness ledger').map((cells) => ({
    id: cells[0] ?? '',
    priority: cells[1] ?? '',
    finding: cells[2] ?? '',
    ownerRole: cells[3] ?? '',
    status: cells[4] ?? '',
    pullRequestOrBranch: cells[5] ?? '',
    evidence: cells[6] ?? '',
    closeCondition: cells[7] ?? '',
    residualRisk: cells[8] ?? '',
    decisionRecord: cells[9] ?? '',
    independentApprover: cells[10] ?? '',
    securityAuthorityRecord: cells[11] ?? '',
  }));
}

export function parseExceptionRows(text: string): ExceptionRow[] {
  return rowsUnderHeader(text, EXCEPTION_HEADER, 'P1 exception register').map((cells) => ({
    findingId: cells[0] ?? '',
    accountableOwner: cells[1] ?? '',
    expiryDate: cells[2] ?? '',
    mitigation: cells[3] ?? '',
    publicLimitation: cells[4] ?? '',
    residualRisk: cells[5] ?? '',
    decisionRecord: cells[6] ?? '',
    independentApprover: cells[7] ?? '',
    securityAuthorityRecord: cells[8] ?? '',
  }));
}

function isPlaceholder(value: string): boolean {
  return value.toLowerCase().startsWith('not applicable');
}

function needsSecurityAuthority(id: string): boolean {
  return id.startsWith('SEC-') || SECURITY_SENSITIVE_IDS.has(id);
}

function duplicateIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates].sort();
}

function isTerminalStatus(status: string): boolean {
  return status === 'Closed' || status === 'Accepted P1 exception';
}

function fieldMissing(value: string): boolean {
  return value.length === 0 || isPlaceholder(value);
}

function identifiesReleaseMaintainer(value: string): boolean {
  return value.toLowerCase().includes('release maintainer');
}

function findingId(id: string): string {
  return id || 'unknown';
}

function validateInventory(
  planFindings: readonly PlanFinding[],
  findingRows: readonly FindingRow[],
): string[] {
  const errors: string[] = [];
  for (const id of duplicateIds(planFindings.map((finding) => finding.id))) {
    errors.push(`Duplicate plan finding ID: ${id}.`);
  }
  for (const id of duplicateIds(findingRows.map((row) => row.id))) {
    errors.push(`Duplicate ledger finding ID: ${id}.`);
  }

  const planById = new Map(planFindings.map((finding) => [finding.id, finding.priority]));
  const ledgerById = new Map(findingRows.map((row) => [row.id, row.priority]));
  for (const id of [...planById.keys()].sort()) {
    const planPriority = planById.get(id);
    const ledgerPriority = ledgerById.get(id);
    if (ledgerPriority === undefined) {
      errors.push(`Missing ledger finding ID: ${id}.`);
      continue;
    }
    if (planPriority !== ledgerPriority) errors.push(`Priority mismatch for finding ID ${id}.`);
  }
  for (const id of [...ledgerById.keys()].sort()) {
    if (!planById.has(id)) errors.push(`Extra ledger finding ID: ${id}.`);
  }
  return errors;
}

function findingFields(row: FindingRow): ReadonlyArray<readonly [string, string]> {
  return [
    ['ID', row.id],
    ['Priority', row.priority],
    ['Finding', row.finding],
    ['Accountable owner role', row.ownerRole],
    ['Status', row.status],
    ['Pull request or branch', row.pullRequestOrBranch],
    ['Evidence', row.evidence],
    ['Objective close condition', row.closeCondition],
    ['Residual risk', row.residualRisk],
    ['Decision record', row.decisionRecord],
    ['Independent approver', row.independentApprover],
    ['Security authority record', row.securityAuthorityRecord],
  ];
}

function validateTerminalFinding(row: FindingRow): string[] {
  if (!isTerminalStatus(row.status)) return [];
  const id = findingId(row.id);
  const errors: string[] = [];
  if (fieldMissing(row.decisionRecord)) {
    errors.push(`Finding ID ${id} is missing decision record for status ${row.status}.`);
  }
  if (fieldMissing(row.independentApprover)) {
    errors.push(`Finding ID ${id} is missing independent approver for status ${row.status}.`);
  }
  if (row.independentApprover === row.ownerRole) {
    errors.push(`Finding ID ${id} has a non-independent approver.`);
  }
  if (
    !(fieldMissing(row.independentApprover) || identifiesReleaseMaintainer(row.independentApprover))
  ) {
    errors.push(`Finding ID ${id} has an approver that is not identified as a Release maintainer.`);
  }
  if (needsSecurityAuthority(row.id) && fieldMissing(row.securityAuthorityRecord)) {
    errors.push(`Finding ID ${id} is missing security authority record for status ${row.status}.`);
  }
  return errors;
}

function validateFindingRow(row: FindingRow): string[] {
  const id = findingId(row.id);
  const errors: string[] = [];
  for (const [field, value] of findingFields(row)) {
    if (value.length === 0) errors.push(`Finding ID ${id} is missing ${field}.`);
  }
  if (row.priority !== 'P0' && row.priority !== 'P1') {
    errors.push(`Finding ID ${id} has an invalid priority.`);
  }
  if (!OWNER_ROLES.has(row.ownerRole)) errors.push(`Finding ID ${id} has an invalid owner role.`);
  if (!STATUSES.has(row.status)) errors.push(`Finding ID ${id} has an invalid status.`);
  if (row.priority === 'P0' && row.status === 'Accepted P1 exception') {
    errors.push(`Finding ID ${id} is P0 and cannot use Accepted P1 exception.`);
  }
  return errors.concat(validateTerminalFinding(row));
}

function exceptionFields(exception: ExceptionRow): ReadonlyArray<readonly [string, string]> {
  return [
    ['Accountable owner', exception.accountableOwner],
    ['Expiry date', exception.expiryDate],
    ['Mitigation', exception.mitigation],
    ['Public limitation', exception.publicLimitation],
    ['Residual risk', exception.residualRisk],
    ['Decision record', exception.decisionRecord],
    ['Independent approver', exception.independentApprover],
    ['Security authority record', exception.securityAuthorityRecord],
  ];
}

function validateExceptionRow(
  exception: ExceptionRow,
  findingById: ReadonlyMap<string, FindingRow>,
): string[] {
  const id = findingId(exception.findingId);
  const errors: string[] = [];
  for (const [field, value] of exceptionFields(exception)) {
    const securityAuthorityIsOptional =
      field === 'Security authority record' && !needsSecurityAuthority(exception.findingId);
    if (fieldMissing(value) && !securityAuthorityIsOptional) {
      errors.push(`P1 exception finding ID ${id} is missing ${field}.`);
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exception.expiryDate)) {
    errors.push(`P1 exception finding ID ${id} has an invalid Expiry date.`);
  }
  if (
    !(
      fieldMissing(exception.independentApprover) ||
      identifiesReleaseMaintainer(exception.independentApprover)
    )
  ) {
    errors.push(
      `P1 exception finding ID ${id} has an approver that is not identified as a Release maintainer.`,
    );
  }
  const finding = findingById.get(exception.findingId);
  if (finding === undefined || finding.priority !== 'P1') {
    errors.push(`P1 exception finding ID ${id} is not a P1 finding.`);
  } else if (finding.status !== 'Accepted P1 exception') {
    errors.push(`P1 exception finding ID ${id} is not in Accepted P1 exception status.`);
  }
  return errors;
}

export function validateReadinessLedger(
  planFindings: readonly PlanFinding[],
  findingRows: readonly FindingRow[],
  exceptionRows: readonly ExceptionRow[],
): string[] {
  const errors = validateInventory(planFindings, findingRows);
  for (const row of findingRows) errors.push(...validateFindingRow(row));
  const findingById = new Map(findingRows.map((row) => [row.id, row]));
  const exceptionById = new Map<string, ExceptionRow>();
  for (const id of duplicateIds(exceptionRows.map((row) => row.findingId))) {
    errors.push(`Duplicate P1 exception finding ID: ${id}.`);
  }
  for (const exception of exceptionRows) {
    exceptionById.set(exception.findingId, exception);
    errors.push(...validateExceptionRow(exception, findingById));
  }
  for (const row of findingRows) {
    if (row.status === 'Accepted P1 exception' && !exceptionById.has(row.id)) {
      errors.push(`Finding ID ${row.id || 'unknown'} has no P1 exception record.`);
    }
  }
  return errors;
}

async function main(): Promise<void> {
  const root = `${import.meta.dir}/..`;
  const plan = await readFile(
    `${root}/docs/superpowers/plans/2026-08-09-open-source-readiness.md`,
    'utf8',
  );
  const ledger = await readFile(`${root}/docs/maintainers/readiness-ledger.md`, 'utf8');
  const planFindings = parsePlanFindings(plan);
  const errors = validateReadinessLedger(
    planFindings,
    parseFindingRows(ledger),
    parseExceptionRows(ledger),
  );
  if (errors.length > 0) {
    for (const error of errors) console.log(error);
    console.log(`\n${errors.length} readiness ledger validation error(s).`);
    process.exit(1);
  }
  console.log(`OK: readiness ledger matches ${planFindings.length} P0/P1 plan findings.`);
}

if (import.meta.main) await main();
