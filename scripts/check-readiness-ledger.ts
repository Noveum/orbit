import { readFile } from 'node:fs/promises';
import { readinessReferenceRegistry } from './readiness-reference-registry.ts';

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
const FINDING_ID = /^[A-Z][A-Z0-9]*-\d{3}$/;
const RECORD = /^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9._/-]*$/;
const PRINCIPAL = /^principal:[a-z0-9][a-z0-9._/-]*$/;
const PLAN_HEADER = ['ID', 'Priority', 'Finding', 'Verified evidence', 'Required outcome'];
const FINDING_HEADER = [
  'ID',
  'Priority',
  'Finding',
  'Accountable owner role',
  'Accountable owner reference',
  'Security authority required',
  'Status',
  'Implementation evidence',
  'Change evidence',
  'Release-gate evidence',
  'Documentation evidence',
  'Objective close condition',
  'Residual-risk record',
  'Decision record',
  'Independent Release approver',
  'Security authority record',
];
const EXCEPTION_HEADER = [
  'Finding ID',
  'Accountable owner reference',
  'Expiry date',
  'Mitigation evidence',
  'Public limitation',
  'Residual-risk record',
  'Decision record',
  'Independent Release approver',
  'Security authority record',
];

export interface PlanFinding {
  readonly id: string;
  readonly priority: string;
}
export interface FindingRow {
  readonly row: number;
  readonly id: string;
  readonly priority: string;
  readonly finding: string;
  readonly ownerRole: string;
  readonly ownerReference: string;
  readonly securityRequired: string;
  readonly status: string;
  readonly implementation: string;
  readonly change: string;
  readonly releaseGate: string;
  readonly documentation: string;
  readonly closeCondition: string;
  readonly residualRisk: string;
  readonly decision: string;
  readonly approver: string;
  readonly authority: string;
}
export interface ExceptionRow {
  readonly row: number;
  readonly findingId: string;
  readonly ownerReference: string;
  readonly expiry: string;
  readonly mitigation: string;
  readonly limitation: string;
  readonly residualRisk: string;
  readonly decision: string;
  readonly approver: string;
  readonly authority: string;
}

export function currentUtcDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function activeLines(text: string): string[] {
  let fence: { readonly character: string; readonly length: number } | undefined;
  return text.split('\n').map((line) => {
    const marker = /^(?: {0,3})(`{3,}|~{3,})/.exec(line);
    if (marker !== null) {
      const value = marker[1] ?? '';
      const character = value[0] ?? '';
      if (fence === undefined) fence = { character, length: value.length };
      else if (fence.character === character && value.length >= fence.length) fence = undefined;
      return '';
    }
    return fence === undefined ? line : '';
  });
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Markdown cell parsing keeps escape and code-span state local.
function cells(line: string): string[] | undefined {
  const trimmed = line.trim();
  if (!(trimmed.startsWith('|') && trimmed.endsWith('|'))) return undefined;
  const values: string[] = [];
  let value = '';
  let escaped = false;
  let codeDelimiter = 0;
  const content = trimmed.slice(1, -1);
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index] ?? '';
    if (escaped) {
      value += character;
      escaped = false;
      continue;
    }
    if (character === '\\') {
      value += character;
      escaped = true;
      continue;
    }
    if (character === '`') {
      const run = /^`+/.exec(content.slice(index))?.[0].length ?? 1;
      if (codeDelimiter === 0) codeDelimiter = run;
      else if (codeDelimiter === run) codeDelimiter = 0;
      value += content.slice(index, index + run);
      index += run - 1;
      continue;
    }
    if (character === '|' && codeDelimiter === 0) {
      values.push(value.trim());
      value = '';
      continue;
    }
    value += character;
  }
  values.push(value.trim());
  return values;
}

function matchesHeader(line: string, header: readonly string[]): boolean {
  const value = cells(line);
  return (
    value !== undefined &&
    value.length === header.length &&
    value.every((cell, index) => cell === header[index])
  );
}

function separator(line: string, width: number): boolean {
  const value = cells(line);
  return (
    value !== undefined && value.length === width && value.every((cell) => /^:?-{3,}:?$/.test(cell))
  );
}

function section(lines: readonly string[], heading: string): readonly [number, number] {
  const matches = lines.flatMap((line, index) => (line.trim() === `## ${heading}` ? [index] : []));
  if (matches.length !== 1) throw new Error(`Expected one ${heading} section.`);
  const start = matches[0] ?? 0;
  const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line.trim()));
  return [start + 1, end === -1 ? lines.length : end];
}

function idPriorityShape(line: string): boolean {
  const value = cells(line);
  return (
    value !== undefined &&
    value.length >= 2 &&
    FINDING_ID.test(value[0] ?? '') &&
    /^(P0|P1)$/.test(value[1] ?? '')
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The table boundary checks are one parser contract.
function scopedTable(
  lines: readonly string[],
  heading: string,
  header: readonly string[],
  kind: string,
  rejectFindingShapes: boolean,
): Array<{ readonly row: number; readonly cells: string[] }> {
  const [start, end] = section(lines, heading);
  const headers = lines.flatMap((line, index) => (matchesHeader(line, header) ? [index] : []));
  if (headers.length !== 1)
    throw new Error(`Expected one ${kind} table; duplicate ${kind} table schema found.`);
  const headerIndex = headers[0] ?? 0;
  if (headerIndex < start || headerIndex >= end)
    throw new Error(`${kind} table is outside its documented section.`);
  if (!separator(lines[headerIndex + 1] ?? '', header.length))
    throw new Error(`${kind} table has an invalid separator.`);
  const rows: Array<{ readonly row: number; readonly cells: string[] }> = [];
  let index = headerIndex + 2;
  while (index < end) {
    const line = lines[index] ?? '';
    if (!line.trimStart().startsWith('|')) break;
    const value = cells(line);
    if (value === undefined || value.length !== header.length)
      throw new Error(`${kind} table has an invalid row shape.`);
    rows.push({ row: index - headerIndex + 1, cells: value });
    index += 1;
  }
  if (rejectFindingShapes) {
    for (const [lineIndex, line] of lines.entries()) {
      if (lineIndex >= headerIndex && lineIndex < index) continue;
      if (idPriorityShape(line))
        throw new Error(`Finding-shaped row is outside the selected ${kind} table.`);
    }
  }
  if (lines.slice(index, end).some((line) => line.trimStart().startsWith('|')))
    throw new Error(`${kind} table is split or has stray rows.`);
  return rows;
}

export function parsePlanFindings(text: string): PlanFinding[] {
  const rows = scopedTable(
    activeLines(text),
    'Findings register',
    PLAN_HEADER,
    'plan findings',
    true,
  );
  return rows
    .map((row) => ({ id: row.cells[0] ?? '', priority: row.cells[1] ?? '' }))
    .filter((finding) => finding.priority === 'P0' || finding.priority === 'P1');
}

export function parseFindingRows(text: string): FindingRow[] {
  return scopedTable(
    activeLines(text),
    'Readiness findings register',
    FINDING_HEADER,
    'findings',
    true,
  ).map((row) => ({
    row: row.row,
    id: row.cells[0] ?? '',
    priority: row.cells[1] ?? '',
    finding: row.cells[2] ?? '',
    ownerRole: row.cells[3] ?? '',
    ownerReference: row.cells[4] ?? '',
    securityRequired: row.cells[5] ?? '',
    status: row.cells[6] ?? '',
    implementation: row.cells[7] ?? '',
    change: row.cells[8] ?? '',
    releaseGate: row.cells[9] ?? '',
    documentation: row.cells[10] ?? '',
    closeCondition: row.cells[11] ?? '',
    residualRisk: row.cells[12] ?? '',
    decision: row.cells[13] ?? '',
    approver: row.cells[14] ?? '',
    authority: row.cells[15] ?? '',
  }));
}

export function parseExceptionRows(text: string): ExceptionRow[] {
  return scopedTable(
    activeLines(text),
    'P1 exception register',
    EXCEPTION_HEADER,
    'P1 exceptions',
    false,
  ).map((row) => ({
    row: row.row,
    findingId: row.cells[0] ?? '',
    ownerReference: row.cells[1] ?? '',
    expiry: row.cells[2] ?? '',
    mitigation: row.cells[3] ?? '',
    limitation: row.cells[4] ?? '',
    residualRisk: row.cells[5] ?? '',
    decision: row.cells[6] ?? '',
    approver: row.cells[7] ?? '',
    authority: row.cells[8] ?? '',
  }));
}

function validId(id: string): boolean {
  return FINDING_ID.test(id);
}
function safeId(id: string, row: number, kind: string): string {
  return validId(id) ? `${kind} ID ${id}` : `${kind} row ${row}`;
}
function reference(value: string): boolean {
  return RECORD.test(value);
}
function prefixedReference(value: string, prefix: string): boolean {
  return value.startsWith(`${prefix}:`) && reference(value.slice(prefix.length + 1));
}
function pending(value: string): boolean {
  return value === 'pending:open';
}
function securityRequired(value: string): boolean | undefined {
  if (value === 'Yes') return true;
  if (value === 'No') return false;
  return undefined;
}
function decision(value: string):
  | {
      readonly record: string;
      readonly implementation: string;
      readonly finding: string;
      readonly approver: string;
    }
  | undefined {
  const parts = value.split(';');
  if (parts.length !== 4) return undefined;
  const record = parts[0]?.slice('decision:'.length) ?? '';
  const implementation = parts[1]?.slice('implementation='.length) ?? '';
  const finding = parts[2]?.slice('finding='.length) ?? '';
  const approver = parts[3]?.slice('approver='.length) ?? '';
  const labels = [
    parts[0]?.startsWith('decision:'),
    parts[1]?.startsWith('implementation='),
    parts[2]?.startsWith('finding='),
    parts[3]?.startsWith('approver='),
  ];
  if (!labels.every(Boolean)) return undefined;
  return reference(record) &&
    PRINCIPAL.test(implementation) &&
    PRINCIPAL.test(finding) &&
    PRINCIPAL.test(approver)
    ? { record, implementation, finding, approver }
    : undefined;
}
function approver(value: string): string | undefined {
  const identity = value.slice('approver:'.length);
  return value.startsWith('approver:') && PRINCIPAL.test(identity) ? identity : undefined;
}
function authority(value: string): boolean {
  return prefixedReference(value, 'authority') && PRINCIPAL.test(value.slice('authority:'.length));
}
function calendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}
function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) result.add(value);
    seen.add(value);
  }
  return [...result].sort();
}

function validateOpen(row: FindingRow, security: boolean): string[] {
  const errors: string[] = [];
  const fields: ReadonlyArray<readonly [string, string]> = [
    ['implementation evidence', row.implementation],
    ['change evidence', row.change],
    ['release-gate evidence', row.releaseGate],
    ['documentation evidence', row.documentation],
    ['decision record', row.decision],
    ['independent approver', row.approver],
  ];
  for (const [field, value] of fields)
    if (!pending(value))
      errors.push(`${safeId(row.id, row.row, 'Finding')} has invalid ${field} for Open status.`);
  if (security ? !pending(row.authority) : row.authority !== 'not-required')
    errors.push(
      `${safeId(row.id, row.row, 'Finding')} has invalid security authority record for Open status.`,
    );
  return errors;
}

function validateTransition(row: FindingRow, security: boolean): string[] {
  const id = safeId(row.id, row.row, 'Finding');
  const errors: string[] = [];
  const evidence: ReadonlyArray<readonly [string, string, string]> = [
    ['implementation evidence', row.implementation, 'implementation'],
    ['release-gate evidence', row.releaseGate, 'gate'],
    ['documentation evidence', row.documentation, 'docs'],
    ['residual-risk record', row.residualRisk, 'risk'],
  ];
  for (const [field, value, prefix] of evidence)
    if (!prefixedReference(value, prefix)) errors.push(`${id} has invalid ${field}.`);
  const changeValid =
    prefixedReference(row.change, 'test') ||
    /^test-na:record:[a-z0-9][a-z0-9._/-]*;justification=record:[a-z0-9][a-z0-9._/-]*;approver=principal:[a-z0-9][a-z0-9._/-]*$/.test(
      row.change,
    );
  if (!changeValid) errors.push(`${id} has invalid change evidence.`);
  const parsedDecision = decision(row.decision);
  const parsedApprover = approver(row.approver);
  if (parsedDecision === undefined) errors.push(`${id} has invalid decision record.`);
  if (parsedApprover === undefined) errors.push(`${id} has invalid independent approver.`);
  if (parsedDecision !== undefined && parsedApprover !== undefined) {
    if (parsedDecision.finding !== row.ownerReference || parsedDecision.approver !== parsedApprover)
      errors.push(`${id} has an independent approver that does not match its decision.`);
    if (
      new Set([parsedDecision.implementation, parsedDecision.finding, parsedDecision.approver])
        .size !== 3
    )
      errors.push(`${id} has a decision with non-independent principals.`);
  }
  if (security && !authority(row.authority))
    errors.push(`${id} is missing security authority record.`);
  if (!security && row.authority !== 'not-required')
    errors.push(`${id} has an unexpected security authority record.`);
  return errors;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Finding validation keeps the status contract in one place.
function validateFinding(row: FindingRow): string[] {
  const id = safeId(row.id, row.row, 'Finding');
  const errors: string[] = [];
  if (!validId(row.id)) errors.push(`Finding row ${row.row} has an invalid ID.`);
  if (!['P0', 'P1'].includes(row.priority)) errors.push(`${id} has an invalid priority.`);
  if (row.finding.length === 0 || row.closeCondition.length === 0)
    errors.push(`${id} has incomplete required fields.`);
  if (!(OWNER_ROLES.has(row.ownerRole) && PRINCIPAL.test(row.ownerReference)))
    errors.push(`${id} has invalid accountable owner data.`);
  const security = securityRequired(row.securityRequired);
  if (security === undefined) errors.push(`${id} has an invalid security authority requirement.`);
  if (!STATUSES.has(row.status)) errors.push(`${id} has an invalid status.`);
  if (!prefixedReference(row.residualRisk, 'risk'))
    errors.push(`${id} has invalid residual-risk record.`);
  if (row.priority === 'P0' && row.status === 'Accepted P1 exception')
    errors.push(`${id} is P0 and cannot use Accepted P1 exception.`);
  if (security !== undefined && row.status === 'In progress') {
    if (!prefixedReference(row.implementation, 'implementation'))
      errors.push(`${id} has invalid implementation evidence for In progress status.`);
    if (
      ![row.change, row.releaseGate, row.documentation, row.decision, row.approver].every(pending)
    )
      errors.push(`${id} has invalid unfinished evidence for In progress status.`);
    if (security ? !pending(row.authority) : row.authority !== 'not-required')
      errors.push(`${id} has invalid security authority record for In progress status.`);
  } else if (security !== undefined)
    errors.push(
      ...(row.status === 'Open' ? validateOpen(row, security) : validateTransition(row, security)),
    );
  return errors;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The exception transition validates one cross-record contract.
function validateException(
  exception: ExceptionRow,
  finding: FindingRow | undefined,
  verificationDate: string,
): string[] {
  const id = safeId(exception.findingId, exception.row, 'P1 exception finding');
  const errors: string[] = [];
  if (!validId(exception.findingId))
    errors.push(`P1 exception row ${exception.row} has an invalid ID.`);
  if (!calendarDate(exception.expiry))
    errors.push(`P1 exception row ${exception.row} has an invalid expiry date.`);
  else if (exception.expiry <= verificationDate)
    errors.push(
      `P1 exception row ${exception.row} has an expiry date that is not after the verification date.`,
    );
  const validFields = [
    PRINCIPAL.test(exception.ownerReference),
    prefixedReference(exception.mitigation, 'mitigation'),
    exception.limitation.length > 0,
    prefixedReference(exception.residualRisk, 'risk'),
    decision(exception.decision) !== undefined,
    approver(exception.approver) !== undefined,
  ];
  if (!validFields.every(Boolean)) errors.push(`${id} has invalid required fields.`);
  const parsedDecision = decision(exception.decision);
  const parsedApprover = approver(exception.approver);
  if (
    parsedDecision !== undefined &&
    parsedApprover !== undefined &&
    new Set([exception.ownerReference, parsedApprover]).size !== 2
  )
    errors.push(`${id} has a non-independent approver.`);
  if (
    finding === undefined ||
    finding.priority !== 'P1' ||
    finding.status !== 'Accepted P1 exception'
  )
    errors.push(`${id} is not an accepted P1 finding.`);
  if (finding !== undefined) {
    if (exception.ownerReference !== finding.ownerReference)
      errors.push(`${id} has an accountable owner mismatch.`);
    if (exception.residualRisk !== finding.residualRisk)
      errors.push(`${id} has a residual-risk record mismatch.`);
    if (exception.decision !== finding.decision)
      errors.push(`${id} has a decision record mismatch.`);
    if (exception.approver !== finding.approver)
      errors.push(`${id} has an independent approver mismatch.`);
    const security = securityRequired(finding.securityRequired) ?? false;
    if (security && exception.authority !== finding.authority)
      errors.push(`${id} has a security authority record mismatch.`);
    if (!security && exception.authority !== 'not-required')
      errors.push(`${id} has an unexpected security authority record.`);
  }
  return errors;
}

type ReferenceRegistry = typeof readinessReferenceRegistry;

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Resolution validates references and role authority together.
function registryErrors(
  findings: readonly FindingRow[],
  exceptions: readonly ExceptionRow[],
  registry: ReferenceRegistry,
): string[] {
  const errors: string[] = [];
  for (const row of [...findings, ...exceptions]) {
    const id = 'id' in row ? row.id : row.findingId;
    const values = Object.values(row).filter((value): value is string => typeof value === 'string');
    for (const value of values.flatMap(
      (entry) => entry.match(/(?:record|principal):[a-z0-9][a-z0-9._/-]*/g) ?? [],
    )) {
      const known = value.startsWith('record:')
        ? registry.records.has(value)
        : registry.principals.has(value);
      if (!known) errors.push(`${safeId(id, row.row, 'Ledger')} has an unresolved reference.`);
    }
  }
  for (const finding of findings) {
    if (finding.status === 'Open' || finding.status === 'In progress') continue;
    const identity = approver(finding.approver);
    if (identity !== undefined && registry.principals.get(identity)?.role !== 'Release maintainer')
      errors.push(
        `${safeId(finding.id, finding.row, 'Finding')} has an approver without Release maintainer authority.`,
      );
    const nonBehavioral =
      /^test-na:record:[a-z0-9][a-z0-9._/-]*;justification=record:[a-z0-9][a-z0-9._/-]*;approver=(principal:[a-z0-9][a-z0-9._/-]*)$/.exec(
        finding.change,
      );
    if (nonBehavioral !== null) {
      const approval = nonBehavioral[1] ?? '';
      const parsed = decision(finding.decision);
      if (
        registry.principals.get(approval)?.role !== 'Release maintainer' ||
        parsed === undefined ||
        approval !== parsed.approver ||
        approval === parsed.implementation ||
        approval === parsed.finding
      )
        errors.push(
          `${safeId(finding.id, finding.row, 'Finding')} has an invalid non-behavioral approval.`,
        );
    }
  }
  return errors;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The inventory gate evaluates all independent controls deterministically.
export function validateReadinessLedger(
  plan: readonly PlanFinding[],
  findings: readonly FindingRow[],
  exceptions: readonly ExceptionRow[],
  verificationDate: string,
  registry?: ReferenceRegistry,
): string[] {
  const errors: string[] = [];
  if (!calendarDate(verificationDate)) return ['Verification date is invalid.'];
  for (const id of duplicates(plan.map((finding) => finding.id)))
    if (validId(id)) errors.push(`Duplicate plan finding ID: ${id}.`);
  for (const row of findings) errors.push(...validateFinding(row));
  for (const id of duplicates(findings.filter((row) => validId(row.id)).map((row) => row.id)))
    errors.push(`Duplicate ledger finding ID: ${id}.`);
  const planById = new Map(
    plan.filter((finding) => validId(finding.id)).map((finding) => [finding.id, finding.priority]),
  );
  const findingById = new Map(
    findings.filter((row) => validId(row.id)).map((row) => [row.id, row]),
  );
  for (const [id, priority] of [...planById.entries()].sort()) {
    const finding = findingById.get(id);
    if (finding === undefined) errors.push(`Missing ledger finding ID: ${id}.`);
    else if (finding.priority !== priority) errors.push(`Priority mismatch for finding ID ${id}.`);
  }
  for (const id of [...findingById.keys()].sort())
    if (!planById.has(id)) errors.push(`Extra ledger finding ID: ${id}.`);
  for (const id of duplicates(
    exceptions.filter((row) => validId(row.findingId)).map((row) => row.findingId),
  ))
    errors.push(`Duplicate P1 exception finding ID: ${id}.`);
  for (const exception of exceptions)
    errors.push(
      ...validateException(exception, findingById.get(exception.findingId), verificationDate),
    );
  const exceptionIds = new Set(
    exceptions.filter((row) => validId(row.findingId)).map((row) => row.findingId),
  );
  for (const finding of findings)
    if (finding.status === 'Accepted P1 exception' && !exceptionIds.has(finding.id))
      errors.push(`${safeId(finding.id, finding.row, 'Finding')} has no P1 exception record.`);
  if (registry !== undefined) errors.push(...registryErrors(findings, exceptions, registry));
  return errors;
}

async function main(): Promise<void> {
  const root = `${import.meta.dir}/..`;
  const [plan, ledger] = await Promise.all([
    readFile(`${root}/docs/superpowers/plans/2026-08-09-open-source-readiness.md`, 'utf8'),
    readFile(`${root}/docs/maintainers/readiness-ledger.md`, 'utf8'),
  ]);
  const findings = parseFindingRows(ledger);
  const errors = validateReadinessLedger(
    parsePlanFindings(plan),
    findings,
    parseExceptionRows(ledger),
    currentUtcDate(),
    readinessReferenceRegistry,
  );
  if (errors.length > 0) {
    for (const error of errors) console.log(error);
    process.exit(1);
  }
  console.log(`OK: readiness ledger matches ${findings.length} P0/P1 plan findings.`);
}

if (import.meta.main) await main();
