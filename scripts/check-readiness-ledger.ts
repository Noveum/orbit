import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readinessReferenceRegistrySourceSchema } from '../packages/shared/src/validators/readiness.ts';
import {
  createProductionReadinessEvidenceVerifier,
  type HostedEvidence,
  type ReadinessEvidenceVerifier,
} from './readiness-evidence-verifier.ts';
import {
  buildReadinessReferenceRegistry,
  type CandidateEvidenceRecord,
  type ClosureEvidenceRecord,
  type EvidenceKind,
  type FailingTestEvidenceRecord,
  type HumanPrincipal,
  IMPLEMENTATION_BASELINE_COMMIT,
  type ReadinessReferenceRegistry,
  type ReadinessReferenceRegistrySource,
  readinessReferenceRegistrySource,
  type WorkflowEvidenceRecord,
} from './readiness-reference-registry.ts';
import {
  computeReadinessScopeDigest,
  computeReadinessTextDigest,
  type ReadinessScopeManifest,
  readinessScopeManifest,
} from './readiness-scope-manifest.ts';

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
const SUBJECT = /^subject:[a-z0-9][a-z0-9._/-]*$/;
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
const HTML_BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'base',
  'basefont',
  'blockquote',
  'body',
  'caption',
  'center',
  'col',
  'colgroup',
  'dd',
  'details',
  'dialog',
  'dir',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'frame',
  'frameset',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hr',
  'html',
  'iframe',
  'legend',
  'li',
  'link',
  'main',
  'menu',
  'menuitem',
  'nav',
  'noframes',
  'ol',
  'optgroup',
  'option',
  'p',
  'param',
  'search',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'title',
  'tr',
  'track',
  'ul',
]);
const COMPLETE_OPENING_HTML_TAG =
  /^<[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \t]*=[ \t]*(?:[^ "'=<>`]+|'[^']*'|"[^"]*"))?)*[ \t]*\/?>[ \t]*$/;
const COMPLETE_CLOSING_HTML_TAG = /^<\/[A-Za-z][A-Za-z0-9-]*[ \t]*>[ \t]*$/;
const HTML_TABLE_TAG =
  /<\/?(?:caption|col|colgroup|table|tbody|td|tfoot|th|thead|tr)(?:[ \t]|\/?>|$)/i;

export interface PlanFinding {
  readonly row: number;
  readonly id: string;
  readonly priority: string;
  readonly finding: string;
  readonly verifiedEvidence: string;
  readonly requiredOutcome: string;
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

function rootBlockContent(line: string): string | undefined {
  const spaces = /^ */.exec(line)?.[0].length ?? 0;
  if (spaces > 3 || line[spaces] === '\t') return undefined;
  return line.slice(spaces);
}

function htmlBlockOpening(content: string):
  | {
      readonly end: string | null;
      readonly searchFrom: number;
      readonly interruptsParagraph: boolean;
      readonly isComment: boolean;
    }
  | undefined {
  const lower = content.toLowerCase();
  const rawTag = /^<(script|pre|style|textarea)(?:[ \t]|>|$)/i.exec(content)?.[1];
  const blockTag = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?:[ \t]|\/?>|$)/.exec(content)?.[1];
  if (content.startsWith('<!--'))
    return { end: '-->', searchFrom: 4, interruptsParagraph: true, isComment: true };
  if (content.startsWith('<?'))
    return { end: '?>', searchFrom: 2, interruptsParagraph: true, isComment: false };
  if (content.startsWith('<![CDATA['))
    return { end: ']]>', searchFrom: 9, interruptsParagraph: true, isComment: false };
  if (/^<![A-Z]/.test(content))
    return { end: '>', searchFrom: 2, interruptsParagraph: true, isComment: false };
  if (rawTag !== undefined)
    return {
      end: `</${rawTag.toLowerCase()}>`,
      searchFrom: lower.indexOf('>') + 1,
      interruptsParagraph: true,
      isComment: false,
    };
  if (blockTag !== undefined && HTML_BLOCK_TAGS.has(blockTag.toLowerCase()))
    return { end: null, searchFrom: 0, interruptsParagraph: true, isComment: false };
  if (COMPLETE_OPENING_HTML_TAG.test(content) || COMPLETE_CLOSING_HTML_TAG.test(content))
    return { end: null, searchFrom: 0, interruptsParagraph: false, isComment: false };
  return undefined;
}

function paragraphContent(content: string | undefined): boolean {
  if (content === undefined || content.trim().length === 0) return false;
  if (/^#{1,6}(?:[ \t]+|$)/.test(content)) return false;
  if (/^(?:>[ \t]?|[-+*][ \t]+|\d+[.)][ \t]+)/.test(content)) return false;
  return !/^(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})$/.test(content);
}

function activeLines(text: string): string[] {
  let fence: { readonly character: string; readonly length: number } | undefined;
  let htmlEnd: string | null | undefined;
  let htmlComment = false;
  let paragraphOpen = false;
  return (
    text
      .replace(/\r\n?/g, '\n')
      .split('\n')
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: GFM block precedence requires explicit parser state.
      .map((line) => {
        if (htmlEnd !== undefined) {
          if (!htmlComment && HTML_TABLE_TAG.test(line))
            throw new Error('Visible HTML table alternatives are not allowed.');
          if (htmlEnd === null) {
            if (line.trim().length === 0) htmlEnd = undefined;
          } else if (line.toLowerCase().includes(htmlEnd)) htmlEnd = undefined;
          if (htmlEnd === undefined) htmlComment = false;
          return '';
        }
        if (fence !== undefined) {
          const closing = /^(?: {0,3})(`{3,}|~{3,})[ \t]*$/.exec(line);
          const value = closing?.[1] ?? '';
          if (value[0] === fence.character && value.length >= fence.length) fence = undefined;
          return '';
        }
        const root = rootBlockContent(line);
        const html = root === undefined ? undefined : htmlBlockOpening(root);
        if (html?.isComment !== true && HTML_TABLE_TAG.test(root ?? line))
          throw new Error('Visible HTML table alternatives are not allowed.');
        if (
          root !== undefined &&
          html !== undefined &&
          (html.interruptsParagraph || !paragraphOpen)
        ) {
          if (html.end === null || !root.toLowerCase().slice(html.searchFrom).includes(html.end)) {
            htmlEnd = html.end;
            htmlComment = html.isComment;
          }
          paragraphOpen = false;
          return '';
        }
        const opening = /^(?: {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
        if (opening === null) {
          paragraphOpen = paragraphContent(root);
          return line;
        }
        const value = opening[1] ?? '';
        const info = opening[2] ?? '';
        if (value.startsWith('`') && info.includes('`')) {
          paragraphOpen = paragraphContent(root);
          return line;
        }
        fence = { character: value[0] ?? '', length: value.length };
        paragraphOpen = false;
        return '';
      })
  );
}

function cells(line: string): string[] | undefined {
  const trimmed = rootBlockContent(line)?.trimEnd();
  if (trimmed === undefined) return undefined;
  const values: string[] = [];
  let value = '';
  let escaped = false;
  let delimiterCount = 0;
  let startsWithDelimiter = false;
  let endsWithDelimiter = false;
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index] ?? '';
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
    if (character === '|') {
      delimiterCount += 1;
      startsWithDelimiter ||= index === 0;
      endsWithDelimiter = index === trimmed.length - 1;
      values.push(value.trim().replaceAll('\\|', '|'));
      value = '';
      continue;
    }
    value += character;
  }
  if (delimiterCount === 0) return undefined;
  values.push(value.trim().replaceAll('\\|', '|'));
  if (startsWithDelimiter) values.shift();
  if (endsWithDelimiter) values.pop();
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
  const matches = lines.flatMap((line, index) =>
    rootBlockContent(line)?.trimEnd() === `## ${heading}` ? [index] : [],
  );
  if (matches.length !== 1) throw new Error(`Expected one ${heading} section.`);
  const start = matches[0] ?? 0;
  const end = lines.findIndex(
    (line, index) => index > start && /^##\s+/.test(rootBlockContent(line)?.trimEnd() ?? ''),
  );
  return [start + 1, end === -1 ? lines.length : end];
}

function strayCells(line: string): string[] | undefined {
  let value = line;
  while (true) {
    const root = rootBlockContent(value) ?? value.trimStart();
    const quoted = /^>[ \t]?(.*)$/.exec(root)?.[1];
    if (quoted === undefined) return cells(root);
    value = quoted;
  }
}

function widthCandidate(line: string, width: number): boolean {
  const value = strayCells(line);
  return value !== undefined && value.length === width;
}

function findingWidthCandidate(line: string, width: number): boolean {
  const value = strayCells(line);
  return value !== undefined && value.length === width && /^(P0|P1)$/.test(value[1] ?? '');
}

function findingIdentityCandidate(line: string): boolean {
  const value = strayCells(line);
  return value !== undefined && FINDING_ID.test(value[0] ?? '') && /^(P0|P1)$/.test(value[1] ?? '');
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The table boundary checks are one parser contract.
function scopedTable(
  lines: readonly string[],
  heading: string,
  header: readonly string[],
  kind: string,
  rejectFindingShapes: boolean,
  rejectExceptionShapes = false,
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
    const value = cells(line);
    if (value === undefined) break;
    if (value.length !== header.length) throw new Error(`${kind} table has an invalid row shape.`);
    rows.push({ row: index - headerIndex + 1, cells: value });
    index += 1;
  }
  if (rejectFindingShapes) {
    for (const [lineIndex, line] of lines.entries()) {
      if (lineIndex >= headerIndex && lineIndex < index) continue;
      const tableCandidate =
        kind === 'plan findings'
          ? findingWidthCandidate(line, header.length)
          : widthCandidate(line, header.length);
      if (tableCandidate || findingIdentityCandidate(line))
        throw new Error(
          `${kind === 'plan findings' ? 'Plan' : 'Finding'}-shaped row is outside the selected ${kind} table.`,
        );
    }
  }
  if (rejectExceptionShapes) {
    for (const [lineIndex, line] of lines.entries()) {
      if (lineIndex >= headerIndex && lineIndex < index) continue;
      if (widthCandidate(line, header.length))
        throw new Error(`Exception-shaped row is outside the selected ${kind} table.`);
    }
  }
  if (lines.slice(index, end).some((line) => widthCandidate(line, header.length)))
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
  return rows.map((row) => ({
    row: row.row,
    id: row.cells[0] ?? '',
    priority: row.cells[1] ?? '',
    finding: row.cells[2] ?? '',
    verifiedEvidence: row.cells[3] ?? '',
    requiredOutcome: row.cells[4] ?? '',
  }));
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
    true,
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
function prefixedRecord(value: string, prefix: string): string | undefined {
  if (!value.startsWith(`${prefix}:`)) return undefined;
  const record = value.slice(prefix.length + 1);
  return reference(record) ? record : undefined;
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
function authorityPrincipal(value: string): string | undefined {
  if (!value.startsWith('authority:')) return undefined;
  const principal = value.slice('authority:'.length);
  return PRINCIPAL.test(principal) ? principal : undefined;
}
interface NonBehavioralEvidence {
  readonly record: string;
  readonly justification: string;
  readonly approver: string;
}
interface BehavioralEvidence {
  readonly failing: string;
  readonly passing: string;
}
function behavioralEvidence(value: string): BehavioralEvidence | undefined {
  const parts = value.split(';');
  if (parts.length !== 2) return undefined;
  const failing = parts[0]?.slice('test:first='.length) ?? '';
  const passing = parts[1]?.slice('passing='.length) ?? '';
  if (!(parts[0]?.startsWith('test:first=') && parts[1]?.startsWith('passing='))) return undefined;
  return reference(failing) && reference(passing) ? { failing, passing } : undefined;
}
function nonBehavioralEvidence(value: string): NonBehavioralEvidence | undefined {
  const parts = value.split(';');
  if (parts.length !== 3) return undefined;
  const record = parts[0]?.slice('test-na:'.length) ?? '';
  const justification = parts[1]?.slice('justification='.length) ?? '';
  const approval = parts[2]?.slice('approver='.length) ?? '';
  if (
    !(
      parts[0]?.startsWith('test-na:') &&
      parts[1]?.startsWith('justification=') &&
      parts[2]?.startsWith('approver=')
    )
  )
    return undefined;
  if (!(reference(record) && reference(justification) && PRINCIPAL.test(approval)))
    return undefined;
  return { record, justification, approver: approval };
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

function decodeEntity(entity: string): string {
  const numeric = /^&#(x[\da-f]+|\d+);$/i.exec(entity)?.[1];
  if (numeric !== undefined) {
    const codePoint = Number.parseInt(
      numeric.replace(/^x/i, ''),
      numeric.startsWith('x') ? 16 : 10,
    );
    if (Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff)
      return String.fromCodePoint(codePoint);
    return ' ';
  }
  const named = entity.slice(1, -1).toLowerCase();
  return (
    {
      amp: '&',
      apos: "'",
      gt: '>',
      lt: '<',
      quot: '"',
    }[named] ?? ' '
  );
}

function normalizedLimitation(value: string): string {
  return value
    .replace(/&(?:#[xX][\dA-Fa-f]+|#\d+|[A-Za-z][A-Za-z0-9]+);/g, decodeEntity)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function substantiveLimitation(value: string): boolean {
  const normalized = normalizedLimitation(value);
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.length >= 3 && words.join('').length >= 16;
}

function placeholderLimitation(value: string): boolean {
  const normalized = normalizedLimitation(value);
  const padded = ` ${normalized} `;
  return [
    'pending',
    'tbd',
    't b d',
    'todo',
    'placeholder',
    'not applicable',
    'not yet determined',
    'to be determined',
    'to be decided',
    'deferred',
    'not required',
    'not available',
    'n a',
    'none',
    'unknown',
    'unspecified',
  ].some((reserved) => padded.includes(` ${reserved} `));
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

function manifestErrors(manifest: ReadinessScopeManifest): string[] {
  const errors: string[] = [];
  if (!/^readiness-scope\/\d{4}-\d{2}-\d{2}-v[1-9]\d*$/.test(manifest.version))
    errors.push('Audited scope manifest has an invalid version.');
  if (manifest.findings.length === 0) errors.push('Audited scope manifest is empty.');
  for (const [index, finding] of manifest.findings.entries()) {
    if (!validId(finding.id))
      errors.push(`Audited scope manifest entry ${index + 1} has an invalid ID.`);
    if (finding.priority !== 'P0' && finding.priority !== 'P1')
      errors.push(`Audited scope manifest entry ${index + 1} has an invalid priority.`);
    if (!/^sha256:[a-f0-9]{64}$/.test(finding.findingHash))
      errors.push(`Audited scope manifest entry ${index + 1} has an invalid finding hash.`);
    if (!/^sha256:[a-f0-9]{64}$/.test(finding.requiredOutcomeHash))
      errors.push(
        `Audited scope manifest entry ${index + 1} has an invalid required outcome hash.`,
      );
  }
  for (const id of duplicates(manifest.findings.map((finding) => finding.id)))
    if (validId(id)) errors.push(`Audited scope manifest has duplicate finding ID ${id}.`);
  if (
    !/^sha256:[a-f0-9]{64}$/.test(manifest.digest) ||
    manifest.digest !== computeReadinessScopeDigest(manifest.version, manifest.findings)
  )
    errors.push('Audited scope manifest digest does not match its entries.');
  return errors;
}

interface ScopeInputFinding {
  readonly id: string;
  readonly priority: string;
  readonly finding: string;
  readonly requiredOutcome: string;
}

function scopeInputErrors(
  label: 'plan' | 'ledger',
  findings: readonly ScopeInputFinding[],
  manifest: ReadinessScopeManifest,
): string[] {
  const errors: string[] = [];
  const capitalized = label === 'plan' ? 'Plan' : 'Ledger';
  if (findings.length === 0) errors.push(`${capitalized} audited scope is empty.`);
  const validFindings = findings.filter(
    (finding) => validId(finding.id) && (finding.priority === 'P0' || finding.priority === 'P1'),
  );
  const actual = new Map(validFindings.map((finding) => [finding.id, finding]));
  const expected = new Map(
    manifest.findings
      .filter(
        (finding) =>
          validId(finding.id) && (finding.priority === 'P0' || finding.priority === 'P1'),
      )
      .map((finding) => [finding.id, finding]),
  );
  for (const [id, expectedFinding] of expected) {
    const finding = actual.get(id);
    if (finding === undefined) errors.push(`Audited scope ID ${id} is missing from the ${label}.`);
    else {
      if (finding.priority !== expectedFinding.priority)
        errors.push(`Audited scope priority mismatch for ${label} ID ${id}.`);
      if (computeReadinessTextDigest(finding.finding) !== expectedFinding.findingHash)
        errors.push(`Audited scope finding mismatch for ${label} ID ${id}.`);
      if (
        computeReadinessTextDigest(finding.requiredOutcome) !== expectedFinding.requiredOutcomeHash
      )
        errors.push(`Audited scope required outcome mismatch for ${label} ID ${id}.`);
    }
  }
  for (const finding of validFindings)
    if (!expected.has(finding.id))
      errors.push(`Extra ${label} finding ID outside audited scope: ${finding.id}.`);
  return errors;
}

function planRowErrors(plan: readonly PlanFinding[]): string[] {
  const errors: string[] = [];
  for (const finding of plan) {
    if (!validId(finding.id)) errors.push(`Plan finding row ${finding.row} has an invalid ID.`);
    if (!['P0', 'P1', 'P2', 'P3'].includes(finding.priority))
      errors.push(`${safeId(finding.id, finding.row, 'Plan finding')} has an invalid priority.`);
    if (
      finding.finding.length === 0 ||
      finding.verifiedEvidence.length === 0 ||
      finding.requiredOutcome.length === 0
    )
      errors.push(`${safeId(finding.id, finding.row, 'Plan finding')} has incomplete fields.`);
  }
  return errors;
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
    behavioralEvidence(row.change) !== undefined || nonBehavioralEvidence(row.change) !== undefined;
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
  const limitation = exception.limitation.trim();
  const substantive = substantiveLimitation(limitation);
  if (!substantive || placeholderLimitation(limitation))
    errors.push(`${id} has an invalid public limitation.`);
  const validFields = [
    PRINCIPAL.test(exception.ownerReference),
    prefixedReference(exception.mitigation, 'mitigation'),
    substantive,
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
    !['Ready for closure', 'Accepted P1 exception'].includes(finding.status)
  )
    errors.push(`${id} is not a staged or accepted P1 finding.`);
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

function validHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

function objectValue(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Readonly<Record<string, unknown>>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function closureRowState(
  value: FindingRow | ExceptionRow,
  omitted: ReadonlySet<string>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !omitted.has(key)));
}

export function computeReadinessClosureDigest(
  finding: FindingRow,
  exception: ExceptionRow | undefined,
  registry: ReadinessReferenceRegistry,
): string {
  const findingState = closureRowState(finding, new Set(['row', 'status']));
  const exceptionState =
    exception === undefined ? null : closureRowState(exception, new Set(['row']));
  const references = new Set(
    (JSON.stringify([findingState, exceptionState]).match(
      /(?:record|principal):[a-z0-9][a-z0-9._/-]*/g,
    ) ?? []) as readonly string[],
  );
  const records = [...references]
    .filter((key) => key.startsWith('record:'))
    .sort()
    .flatMap((key) => {
      const record = registry.records.get(key);
      return record === undefined ? [] : [[key, record] as const];
    });
  const principals = [...references]
    .filter((key) => key.startsWith('principal:'))
    .sort()
    .flatMap((key) => {
      const principal = registry.principals.get(key);
      return principal === undefined ? [] : [[key, principal] as const];
    });
  const content = canonicalJson({
    finding: findingState,
    exception: exceptionState,
    records,
    principals,
  });
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function candidateRecordKind(value: unknown): value is CandidateEvidenceRecord['kind'] {
  return ['test', 'gate', 'decision', 'non-behavioral'].includes(String(value));
}

interface ValidCandidateRecord {
  readonly commitSha: string;
  readonly observedAt: string;
}

function immutableRecordCommit(value: unknown): string | undefined {
  const record = objectValue(value);
  const commit = objectValue(record?.['commit']);
  const commitSha = commit?.['commitSha'];
  if (
    commit?.['kind'] !== 'git-commit' ||
    typeof commitSha !== 'string' ||
    !/^[a-f0-9]{40}$/.test(commitSha) ||
    commit['commitUrl'] !== `https://github.com/Noveum/orbit/commit/${commitSha}`
  )
    return undefined;
  return commitSha;
}

function validCandidateRecord(value: unknown): ValidCandidateRecord | undefined {
  const record = objectValue(value);
  if (record === undefined || !candidateRecordKind(record['kind'])) return undefined;
  const candidate = objectValue(record['candidate']);
  const commitSha = candidate?.['commitSha'];
  const commitUrl = candidate?.['commitUrl'];
  if (
    candidate?.['kind'] !== 'git-commit' ||
    typeof commitSha !== 'string' ||
    !/^[a-f0-9]{40}$/.test(commitSha) ||
    commitSha === IMPLEMENTATION_BASELINE_COMMIT ||
    commitUrl !== `https://github.com/Noveum/orbit/commit/${commitSha}` ||
    !canonicalTimestamp(record['observedAt'])
  )
    return undefined;
  return { commitSha, observedAt: record['observedAt'] };
}

function recordObservedAt(value: unknown): string | undefined {
  const observedAt = objectValue(value)?.['observedAt'];
  return canonicalTimestamp(observedAt) ? observedAt : undefined;
}

function recordKeyMatchesKind(recordKey: string, kind: EvidenceKind): boolean {
  const namespace = /^record:([^/]+)\//.exec(recordKey)?.[1];
  return namespace === (kind === 'audit-risk' ? 'audit' : kind);
}

function recordErrors(
  id: string,
  recordKey: string | undefined,
  expectedKinds: ReadonlySet<EvidenceKind>,
  registry: ReadinessReferenceRegistry,
): string[] {
  if (recordKey === undefined) return [];
  const record = registry.records.get(recordKey);
  if (record === undefined) return [`${id} has an unresolved reference.`];
  const errors: string[] = [];
  if (!validHttpsUrl(record.url)) errors.push(`${id} has an invalid evidence link.`);
  if (!(expectedKinds.has(record.kind) && recordKeyMatchesKind(recordKey, record.kind)))
    errors.push(`${id} has an evidence type mismatch.`);
  return errors;
}

function principalErrors(
  id: string,
  principalKey: string,
  registry: ReadinessReferenceRegistry,
): string[] {
  const principal = registry.principals.get(principalKey);
  if (principal === undefined) return [`${id} has an unresolved reference.`];
  const errors: string[] = [];
  if (!validHttpsUrl(principal.assignmentUrl))
    errors.push(`${id} has an invalid principal assignment link.`);
  if (principal.kind === 'human' && !SUBJECT.test(principal.subjectId))
    errors.push(`${id} has an invalid principal subject identity.`);
  return errors;
}

function humanPrincipal(
  principalKey: string | undefined,
  registry: ReadinessReferenceRegistry,
): HumanPrincipal | undefined {
  if (principalKey === undefined) return undefined;
  const principal = registry.principals.get(principalKey);
  return principal?.kind === 'human' ? principal : undefined;
}

function ownerRegistryErrors(finding: FindingRow, registry: ReadinessReferenceRegistry): string[] {
  const id = safeId(finding.id, finding.row, 'Finding');
  const errors = principalErrors(id, finding.ownerReference, registry);
  const owner = registry.principals.get(finding.ownerReference);
  if (owner !== undefined && owner.role !== finding.ownerRole)
    errors.push(`${id} has an accountable owner role mismatch.`);
  if (
    finding.status !== 'Open' &&
    finding.status !== 'In progress' &&
    owner !== undefined &&
    owner.kind !== 'human'
  )
    errors.push(`${id} requires a human accountable owner assignment.`);
  return errors;
}

function findingEvidenceRegistryErrors(
  finding: FindingRow,
  registry: ReadinessReferenceRegistry,
): string[] {
  const id = safeId(finding.id, finding.row, 'Finding');
  const errors = recordErrors(
    id,
    prefixedRecord(finding.residualRisk, 'risk'),
    new Set(['audit-risk', 'risk']),
    registry,
  );
  if (finding.status === 'Open') return errors;
  errors.push(
    ...recordErrors(
      id,
      prefixedRecord(finding.implementation, 'implementation'),
      new Set(['implementation']),
      registry,
    ),
  );
  if (finding.status === 'In progress') return errors;
  const behavioral = behavioralEvidence(finding.change);
  const nonBehavioral = nonBehavioralEvidence(finding.change);
  if (behavioral !== undefined)
    errors.push(
      ...recordErrors(id, behavioral.failing, new Set(['failing-test']), registry),
      ...recordErrors(id, behavioral.passing, new Set(['test']), registry),
    );
  if (nonBehavioral !== undefined) {
    errors.push(
      ...recordErrors(id, nonBehavioral.record, new Set(['non-behavioral']), registry),
      ...recordErrors(id, nonBehavioral.justification, new Set(['justification']), registry),
    );
  }
  errors.push(
    ...recordErrors(id, prefixedRecord(finding.releaseGate, 'gate'), new Set(['gate']), registry),
    ...recordErrors(id, prefixedRecord(finding.documentation, 'docs'), new Set(['docs']), registry),
    ...recordErrors(id, decision(finding.decision)?.record, new Set(['decision']), registry),
  );
  return errors;
}

type HostedWorkflowRecord = FailingTestEvidenceRecord | WorkflowEvidenceRecord;

function actionsAttempt(url: string): number | undefined {
  const value =
    /^https:\/\/github\.com\/Noveum\/orbit\/actions\/runs\/[1-9]\d*\/attempts\/([1-9]\d*)$/.exec(
      url,
    )?.[1];
  if (value === undefined) return undefined;
  return Number(value);
}

function hostedRecordCommit(record: HostedWorkflowRecord): string {
  return record.kind === 'failing-test' ? record.commit.commitSha : record.candidate.commitSha;
}

function exactHostedJob(hosted: HostedEvidence, name: string) {
  const jobs = hosted.jobs.filter((job) => job.name === name);
  return jobs.length === 1 ? jobs[0] : undefined;
}

function unitTestJobValid(
  hosted: HostedEvidence,
  expectedCommit: string,
  expectedConclusion: 'success' | 'failure',
): boolean {
  const job = exactHostedJob(hosted, 'Unit and integration tests');
  if (job === undefined || job.conclusion !== expectedConclusion || job.headSha !== expectedCommit)
    return false;
  const steps = job.steps.filter((step) => step.name === 'Run tests');
  return steps.length === 1 && steps[0]?.conclusion === expectedConclusion;
}

function gateJobsValid(hosted: HostedEvidence, expectedCommit: string): boolean {
  const names = [
    'Lint, comments, types',
    'Unit and integration tests',
    'Migrations match the schema',
    'Build',
    'End-to-end (Playwright)',
    'Readiness release gate',
  ];
  return (
    names.every((name) => {
      const job = exactHostedJob(hosted, name);
      return job?.conclusion === 'success' && job.headSha === expectedCommit;
    }) && unitTestJobValid(hosted, expectedCommit, 'success')
  );
}

function hostedWorkflowValid(record: HostedWorkflowRecord, hosted: HostedEvidence): boolean {
  const expectedConclusion = record.kind === 'failing-test' ? 'failure' : 'success';
  const expectedEvent = record.kind === 'failing-test' ? 'pull_request' : 'push';
  const pullRequestBound =
    record.kind !== 'failing-test' || hosted.pullRequestNumbers.includes(record.pullRequest.number);
  return (
    hosted.workflowPath === '.github/workflows/ci.yml' &&
    hosted.runAttempt === actionsAttempt(record.url) &&
    hosted.event === expectedEvent &&
    hosted.conclusion === expectedConclusion &&
    hosted.runStartedAt <= hosted.updatedAt &&
    hosted.updatedAt <= record.observedAt &&
    pullRequestBound
  );
}

function hostedJobsValid(record: HostedWorkflowRecord, hosted: HostedEvidence): boolean {
  const commit = hostedRecordCommit(record);
  if (record.kind === 'gate') return gateJobsValid(hosted, commit);
  return unitTestJobValid(hosted, commit, record.kind === 'failing-test' ? 'failure' : 'success');
}

function hostedArtifactValid(record: HostedWorkflowRecord, hosted: HostedEvidence): boolean {
  const commit = hostedRecordCommit(record);
  const attempt = actionsAttempt(record.url);
  const expectedName = `${record.kind === 'gate' ? 'readiness-gate' : 'readiness-test'}-${commit}-${attempt}`;
  const artifacts = hosted.artifacts.filter((artifact) => artifact.name === expectedName);
  const artifact = artifacts.length === 1 ? artifacts[0] : undefined;
  return (
    artifact !== undefined &&
    artifact.digest === record.artifactDigest &&
    !artifact.expired &&
    artifact.headSha === commit &&
    hosted.runStartedAt <= artifact.createdAt &&
    artifact.createdAt <= hosted.updatedAt
  );
}

function hostedRecordErrors(
  id: string,
  record: HostedWorkflowRecord,
  verifier: ReadinessEvidenceVerifier,
): string[] {
  const hosted = verifier.hostedEvidence(record.url);
  if (hosted === undefined) return [`${id} has hosted evidence that could not be verified.`];
  const errors: string[] = [];
  if (hosted.headSha !== hostedRecordCommit(record))
    errors.push(`${id} has hosted evidence for a different candidate.`);
  if (!hostedWorkflowValid(record, hosted))
    errors.push(`${id} has hosted evidence with invalid workflow provenance.`);
  if (!hostedJobsValid(record, hosted))
    errors.push(`${id} has hosted evidence with invalid job provenance.`);
  if (!hostedArtifactValid(record, hosted))
    errors.push(`${id} has hosted evidence with invalid artifact provenance.`);
  return errors;
}

const CLOSURE_EVIDENCE_FILES = new Set([
  'docs/maintainers/readiness-ledger.md',
  'scripts/readiness-reference-registry.json',
]);

function historicalRegistry(value: string): ReadinessReferenceRegistry | undefined {
  try {
    const parsed = readinessReferenceRegistrySourceSchema.safeParse(JSON.parse(value));
    if (!parsed.success) return undefined;
    const built = buildReadinessReferenceRegistry(
      parsed.data as unknown as ReadinessReferenceRegistrySource,
    );
    return 'registry' in built ? built.registry : undefined;
  } catch {
    return undefined;
  }
}

function durableSnapshotErrors(
  id: string,
  finding: FindingRow,
  exception: ExceptionRow | undefined,
  registry: ReadinessReferenceRegistry,
  closure: ClosureEvidenceRecord,
  verifier: ReadinessEvidenceVerifier,
): string[] {
  const evidenceCommit = closure.evidenceCommit.commitSha;
  const ledgerText = verifier.artifactAtCommit(
    evidenceCommit,
    'docs/maintainers/readiness-ledger.md',
  );
  const registryText = verifier.artifactAtCommit(
    evidenceCommit,
    'scripts/readiness-reference-registry.json',
  );
  if (ledgerText === undefined || registryText === undefined) {
    return [`${id} has unreadable durable evidence-commit artifacts.`];
  }
  try {
    const historicalFindings = parseFindingRows(ledgerText).filter((row) => row.id === finding.id);
    const historicalExceptions = parseExceptionRows(ledgerText).filter(
      (row) => row.findingId === finding.id,
    );
    const priorFinding = historicalFindings.length === 1 ? historicalFindings[0] : undefined;
    const priorException = historicalExceptions.length === 1 ? historicalExceptions[0] : undefined;
    const priorRegistry = historicalRegistry(registryText);
    const priorClosures =
      priorRegistry === undefined
        ? []
        : [...priorRegistry.records.values()].filter(
            (record) => record.kind === 'closure' && record.findingId === finding.id,
          );
    const exceptionShapeMatches =
      (exception === undefined && historicalExceptions.length === 0) ||
      (exception !== undefined && historicalExceptions.length === 1);
    if (
      priorFinding === undefined ||
      priorFinding.status !== 'Ready for closure' ||
      !exceptionShapeMatches ||
      priorRegistry === undefined ||
      priorClosures.length !== 0
    ) {
      return [`${id} has an invalid durable evidence snapshot.`];
    }
    const currentDigest = computeReadinessClosureDigest(finding, exception, registry);
    const historicalDigest = computeReadinessClosureDigest(
      priorFinding,
      priorException,
      priorRegistry,
    );
    if (closure.evidenceDigest !== currentDigest || closure.evidenceDigest !== historicalDigest)
      return [`${id} has a durable evidence snapshot digest mismatch.`];
  } catch {
    return [`${id} has an invalid durable evidence snapshot.`];
  }
  return [];
}

function durableClosureErrors(
  id: string,
  finding: FindingRow,
  exception: ExceptionRow | undefined,
  registry: ReadinessReferenceRegistry,
  closure: ClosureEvidenceRecord,
  candidateCommit: string | undefined,
  decisionAt: string | undefined,
  verifier: ReadinessEvidenceVerifier,
): string[] {
  const errors: string[] = [];
  const evidenceCommit = closure.evidenceCommit.commitSha;
  if (candidateCommit === undefined || closure.candidate.commitSha !== candidateCommit)
    errors.push(`${id} has durable closure evidence for a different release candidate.`);
  if (
    !verifier.commitExists(evidenceCommit) ||
    evidenceCommit === verifier.currentCommit ||
    !verifier.isAncestor(evidenceCommit, verifier.currentCommit)
  )
    errors.push(`${id} has an invalid durable evidence commit.`);
  if (
    candidateCommit === undefined ||
    candidateCommit === evidenceCommit ||
    !verifier.commitExists(candidateCommit) ||
    !verifier.isAncestor(candidateCommit, evidenceCommit)
  )
    errors.push(`${id} has invalid durable closure chronology.`);
  const changedFiles =
    candidateCommit === undefined
      ? undefined
      : verifier.changedFilesBetween(candidateCommit, evidenceCommit);
  if (
    changedFiles === undefined ||
    changedFiles.length !== CLOSURE_EVIDENCE_FILES.size ||
    changedFiles.some((file) => !CLOSURE_EVIDENCE_FILES.has(file))
  )
    errors.push(`${id} has an invalid durable evidence-commit file shape.`);
  if (decisionAt !== undefined && closure.observedAt <= decisionAt)
    errors.push(`${id} has invalid durable closure observation chronology.`);
  errors.push(...durableSnapshotErrors(id, finding, exception, registry, closure, verifier));
  return errors;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Terminal evidence validates candidate agreement and chronology together.
function terminalEvidenceRegistryErrors(
  finding: FindingRow,
  exception: ExceptionRow | undefined,
  registry: ReadinessReferenceRegistry,
  verifier: ReadinessEvidenceVerifier | undefined,
): string[] {
  const id = safeId(finding.id, finding.row, 'Finding');
  const closures = [...registry.records.values()].filter(
    (record): record is ClosureEvidenceRecord =>
      record.kind === 'closure' && record.findingId === finding.id,
  );
  if (finding.status === 'Open' || finding.status === 'In progress')
    return closures.length === 0 ? [] : [`${id} has premature durable closure evidence.`];
  const sealed = finding.status === 'Closed' || finding.status === 'Accepted P1 exception';
  const errors: string[] = [];
  if (sealed && closures.length !== 1)
    errors.push(`${id} requires exactly one durable closure record.`);
  if (!sealed && closures.length !== 0)
    errors.push(`${id} has durable closure evidence before its seal transition.`);
  const behavioral = behavioralEvidence(finding.change);
  const nonBehavioral = nonBehavioralEvidence(finding.change);
  const implementation = registry.records.get(
    prefixedRecord(finding.implementation, 'implementation') ?? '',
  );
  const gate = registry.records.get(prefixedRecord(finding.releaseGate, 'gate') ?? '');
  const decisionRecord = registry.records.get(decision(finding.decision)?.record ?? '');
  const terminalRecords = [
    behavioral === undefined ? undefined : registry.records.get(behavioral.passing),
    nonBehavioral === undefined ? undefined : registry.records.get(nonBehavioral.record),
    gate,
    decisionRecord,
  ].flatMap((record) => {
    const candidate = validCandidateRecord(record);
    return candidate === undefined ? [] : [candidate];
  });
  if (
    terminalRecords.length >= 2 &&
    new Set(terminalRecords.map((record) => record.commitSha)).size !== 1
  )
    errors.push(`${id} has inconsistent release candidate evidence.`);
  const implementationAt = recordObservedAt(implementation);
  const gateAt = recordObservedAt(gate);
  const decisionAt = recordObservedAt(decisionRecord);
  if (behavioral !== undefined) {
    const failingAt = recordObservedAt(registry.records.get(behavioral.failing));
    const passingAt = recordObservedAt(registry.records.get(behavioral.passing));
    if (
      [failingAt, implementationAt, passingAt, gateAt, decisionAt].every(
        (value) => value !== undefined,
      ) &&
      !(
        String(failingAt) < String(implementationAt) &&
        String(implementationAt) < String(passingAt) &&
        String(passingAt) < String(gateAt) &&
        String(gateAt) < String(decisionAt)
      )
    )
      errors.push(`${id} does not prove failing-first test chronology.`);
  }
  if (nonBehavioral !== undefined) {
    const attestationAt = recordObservedAt(registry.records.get(nonBehavioral.record));
    if (
      [implementationAt, attestationAt, gateAt, decisionAt].every((value) => value !== undefined) &&
      !(
        String(implementationAt) < String(attestationAt) &&
        String(attestationAt) < String(gateAt) &&
        String(gateAt) < String(decisionAt)
      )
    )
      errors.push(`${id} has invalid non-behavioral evidence chronology.`);
  }
  if (verifier === undefined) {
    errors.push(`${id} requires an evidence verification context.`);
    return errors;
  }
  const candidateCommits = new Set(terminalRecords.map((record) => record.commitSha));
  const candidateCommit = candidateCommits.size === 1 ? terminalRecords[0]?.commitSha : undefined;
  const implementationCommit = immutableRecordCommit(implementation);
  const failingRecord =
    behavioral === undefined ? undefined : registry.records.get(behavioral.failing);
  const failingCommit = immutableRecordCommit(failingRecord);
  if (candidateCommit !== undefined) {
    if (!verifier.commitExists(candidateCommit))
      errors.push(`${id} has a release candidate that does not exist in this repository.`);
    if (
      candidateCommit === verifier.currentCommit ||
      !verifier.isAncestor(candidateCommit, verifier.currentCommit)
    )
      errors.push(`${id} has a release candidate outside the checker head ancestry.`);
    if (!sealed) {
      const changedFiles = verifier.changedFilesBetween(candidateCommit, verifier.currentCommit);
      if (
        changedFiles === undefined ||
        changedFiles.some((file) => !CLOSURE_EVIDENCE_FILES.has(file))
      )
        errors.push(`${id} has unapproved changes after its release candidate.`);
    }
  }
  if (
    candidateCommit !== undefined &&
    implementationCommit !== undefined &&
    !(
      verifier.commitExists(IMPLEMENTATION_BASELINE_COMMIT) &&
      verifier.commitExists(implementationCommit) &&
      verifier.isAncestor(IMPLEMENTATION_BASELINE_COMMIT, candidateCommit)
    )
  )
    errors.push(`${id} has invalid immutable commit chronology.`);
  if (candidateCommit !== undefined && implementationCommit !== candidateCommit)
    errors.push(`${id} has implementation evidence for a different release candidate.`);
  if (
    behavioral !== undefined &&
    candidateCommit !== undefined &&
    failingCommit === candidateCommit
  )
    errors.push(`${id} has identical failing and candidate commits.`);
  const hostedRecords = [
    failingRecord,
    behavioral === undefined ? undefined : registry.records.get(behavioral.passing),
    gate,
  ].filter(
    (record): record is HostedWorkflowRecord =>
      record?.kind === 'failing-test' || record?.kind === 'test' || record?.kind === 'gate',
  );
  const closure = closures.length === 1 ? closures[0] : undefined;
  if (sealed && closure !== undefined)
    errors.push(
      ...durableClosureErrors(
        id,
        finding,
        exception,
        registry,
        closure,
        candidateCommit,
        decisionAt,
        verifier,
      ),
    );
  if (!sealed && verifier.hostedEvidenceAvailable) {
    for (const record of hostedRecords) errors.push(...hostedRecordErrors(id, record, verifier));
    if (implementation?.kind === 'implementation' && candidateCommit !== undefined) {
      const pullRequestNumber = implementation.pullRequest.number;
      if (
        failingRecord?.kind === 'failing-test' &&
        failingRecord.pullRequest.number !== pullRequestNumber
      )
        errors.push(`${id} has failing-test evidence for a different pull request.`);
      const pullRequest = verifier.pullRequestEvidence(pullRequestNumber);
      if (pullRequest === undefined || pullRequest.mergedAt === null)
        errors.push(`${id} has unverified implementation pull request evidence.`);
      else {
        if (pullRequest.mergeCommitSha !== candidateCommit)
          errors.push(`${id} has pull request evidence for a different release candidate.`);
        if (implementationAt !== undefined && pullRequest.mergedAt > implementationAt)
          errors.push(`${id} has invalid implementation pull request chronology.`);
      }
    }
  }
  return errors;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Subject resolution enforces one terminal-attestation contract.
function terminalPrincipalRegistryErrors(
  finding: FindingRow,
  registry: ReadinessReferenceRegistry,
): string[] {
  if (finding.status === 'Open' || finding.status === 'In progress') return [];
  const id = safeId(finding.id, finding.row, 'Finding');
  const parsedDecision = decision(finding.decision);
  const approverKey = approver(finding.approver);
  const authorityKey = authorityPrincipal(finding.authority);
  const nonBehavioral = nonBehavioralEvidence(finding.change);
  const keys = [
    finding.ownerReference,
    parsedDecision?.implementation,
    parsedDecision?.finding,
    parsedDecision?.approver,
    approverKey,
    nonBehavioral?.approver,
  ].filter((value): value is string => value !== undefined);
  if (authorityKey !== undefined) keys.push(authorityKey);
  const errors = keys.flatMap((key) => principalErrors(id, key, registry));
  const owner = humanPrincipal(finding.ownerReference, registry);
  const implementationOwner = humanPrincipal(parsedDecision?.implementation, registry);
  const findingOwner = humanPrincipal(parsedDecision?.finding, registry);
  const releaseApprover = humanPrincipal(approverKey, registry);
  if (releaseApprover === undefined || releaseApprover.role !== 'Release maintainer')
    errors.push(`${id} has an approver without Release maintainer authority.`);
  const decisionApprover = humanPrincipal(parsedDecision?.approver, registry);
  if (
    parsedDecision !== undefined &&
    [implementationOwner, findingOwner, decisionApprover].some(
      (principal) => principal === undefined,
    )
  )
    errors.push(`${id} requires human decision principal assignments.`);
  const subjects = [implementationOwner, findingOwner, decisionApprover].flatMap((principal) =>
    principal === undefined ? [] : [principal.subjectId],
  );
  if (subjects.length === 3 && new Set(subjects).size !== 3)
    errors.push(`${id} has a decision with non-independent subjects.`);
  if (
    owner !== undefined &&
    findingOwner !== undefined &&
    owner.subjectId !== findingOwner.subjectId
  )
    errors.push(`${id} has a finding-owner subject mismatch.`);
  if (
    releaseApprover !== undefined &&
    decisionApprover !== undefined &&
    releaseApprover.subjectId !== decisionApprover.subjectId
  )
    errors.push(`${id} has an independent approver subject mismatch.`);
  if (nonBehavioral !== undefined) {
    const approval = humanPrincipal(nonBehavioral.approver, registry);
    if (
      approval === undefined ||
      approval.role !== 'Release maintainer' ||
      decisionApprover === undefined ||
      approval.subjectId !== decisionApprover.subjectId ||
      implementationOwner?.subjectId === approval.subjectId ||
      findingOwner?.subjectId === approval.subjectId
    )
      errors.push(`${id} has an invalid non-behavioral approval.`);
  }
  if (securityRequired(finding.securityRequired)) {
    const securityAuthority = humanPrincipal(authorityKey, registry);
    if (securityAuthority === undefined || securityAuthority.role !== 'Security maintainer')
      errors.push(`${id} has security authority without Security maintainer authority.`);
    if (securityAuthority !== undefined && subjects.includes(securityAuthority.subjectId))
      errors.push(`${id} has non-independent security authority.`);
  }
  return errors;
}

function exceptionRegistryErrors(
  exception: ExceptionRow,
  finding: FindingRow | undefined,
  registry: ReadinessReferenceRegistry,
): string[] {
  const id = safeId(exception.findingId, exception.row, 'P1 exception finding');
  const errors = [
    ...principalErrors(id, exception.ownerReference, registry),
    ...recordErrors(
      id,
      prefixedRecord(exception.mitigation, 'mitigation'),
      new Set(['mitigation']),
      registry,
    ),
    ...recordErrors(
      id,
      prefixedRecord(exception.residualRisk, 'risk'),
      new Set(['audit-risk', 'risk']),
      registry,
    ),
    ...recordErrors(id, decision(exception.decision)?.record, new Set(['decision']), registry),
  ];
  const parsedApprover = humanPrincipal(approver(exception.approver), registry);
  if (parsedApprover === undefined || parsedApprover.role !== 'Release maintainer')
    errors.push(`${id} has an approver without Release maintainer authority.`);
  if (securityRequired(finding?.securityRequired ?? 'No')) {
    const securityAuthority = humanPrincipal(authorityPrincipal(exception.authority), registry);
    if (securityAuthority === undefined || securityAuthority.role !== 'Security maintainer')
      errors.push(`${id} has security authority without Security maintainer authority.`);
  }
  return errors;
}

function registryErrors(
  findings: readonly FindingRow[],
  exceptions: readonly ExceptionRow[],
  registry: ReadinessReferenceRegistry,
  verifier: ReadinessEvidenceVerifier | undefined,
): string[] {
  const findingById = new Map(findings.map((finding) => [finding.id, finding]));
  const exceptionById = new Map(exceptions.map((exception) => [exception.findingId, exception]));
  const orphanedClosures = [...registry.records.values()].filter(
    (record) => record.kind === 'closure' && !findingById.has(record.findingId),
  );
  return [
    ...findings.flatMap((finding) => ownerRegistryErrors(finding, registry)),
    ...findings.flatMap((finding) => findingEvidenceRegistryErrors(finding, registry)),
    ...findings.flatMap((finding) =>
      terminalEvidenceRegistryErrors(finding, exceptionById.get(finding.id), registry, verifier),
    ),
    ...findings.flatMap((finding) => terminalPrincipalRegistryErrors(finding, registry)),
    ...exceptions.flatMap((exception) =>
      exceptionRegistryErrors(exception, findingById.get(exception.findingId), registry),
    ),
    ...orphanedClosures.map(() => 'Registry has durable closure evidence for an unknown finding.'),
  ];
}

function temporalEvidenceErrors(
  source: ReadinessReferenceRegistrySource,
  verificationDate: string,
  verifier: ReadinessEvidenceVerifier | undefined,
): string[] {
  if (verifier === undefined) return [];
  if (!canonicalTimestamp(verifier.verificationInstant))
    return ['Evidence verification instant is invalid.'];
  const errors: string[] = [];
  if (verifier.verificationInstant.slice(0, 10) !== verificationDate)
    errors.push('Evidence verification instant does not match the verification date.');
  for (const [index, [, value]] of source.recordEntries.entries()) {
    const observedAt = objectValue(value)?.['observedAt'];
    if (canonicalTimestamp(observedAt) && observedAt > verifier.verificationInstant)
      errors.push(`Registry record entry ${index + 1} has a future evidence timestamp.`);
  }
  return errors;
}

export interface ReadinessEvidenceTargets {
  readonly hostedEvidenceUrls: readonly string[];
  readonly pullRequestNumbers: readonly number[];
}

export function readinessEvidenceTargets(
  findings: readonly FindingRow[],
  source: ReadinessReferenceRegistrySource,
): ReadinessEvidenceTargets {
  const built = buildReadinessReferenceRegistry(source);
  if (!('registry' in built)) return { hostedEvidenceUrls: [], pullRequestNumbers: [] };
  const urls = new Set<string>();
  const pullRequests = new Set<number>();
  for (const finding of findings) {
    if (finding.status !== 'Ready for closure') continue;
    const behavioral = behavioralEvidence(finding.change);
    const keys = [
      prefixedRecord(finding.implementation, 'implementation'),
      behavioral?.failing,
      behavioral?.passing,
      prefixedRecord(finding.releaseGate, 'gate'),
    ].filter((key): key is string => key !== undefined);
    for (const key of keys) {
      const record = built.registry.records.get(key);
      if (record?.kind === 'failing-test' || record?.kind === 'test' || record?.kind === 'gate')
        urls.add(record.url);
      if (record?.kind === 'implementation' || record?.kind === 'failing-test')
        pullRequests.add(record.pullRequest.number);
    }
  }
  return {
    hostedEvidenceUrls: [...urls].sort(),
    pullRequestNumbers: [...pullRequests].sort((left, right) => left - right),
  };
}

export function validateReadinessScopeArtifacts(
  plan: readonly PlanFinding[],
  findings: readonly FindingRow[],
  scopeManifest: ReadinessScopeManifest,
): string[] {
  const ledgerScope = findings.map((finding) => ({
    id: finding.id,
    priority: finding.priority,
    finding: finding.finding,
    requiredOutcome: finding.closeCondition,
  }));
  const errors = [
    ...manifestErrors(scopeManifest),
    ...planRowErrors(plan),
    ...scopeInputErrors('plan', plan, scopeManifest),
    ...scopeInputErrors('ledger', ledgerScope, scopeManifest),
  ];
  for (const id of duplicates(plan.map((finding) => finding.id)))
    if (validId(id)) errors.push(`Duplicate plan finding ID: ${id}.`);
  for (const id of duplicates(
    findings.filter((finding) => validId(finding.id)).map((finding) => finding.id),
  ))
    errors.push(`Duplicate ledger finding ID: ${id}.`);
  const planById = new Map(
    plan
      .filter(
        (finding) =>
          validId(finding.id) && (finding.priority === 'P0' || finding.priority === 'P1'),
      )
      .map((finding) => [finding.id, finding]),
  );
  for (const finding of findings) {
    const planFinding = planById.get(finding.id);
    if (planFinding === undefined) continue;
    if (finding.finding !== planFinding.finding)
      errors.push(`Finding text mismatch for finding ID ${finding.id}.`);
    if (finding.closeCondition !== planFinding.requiredOutcome)
      errors.push(`Required outcome mismatch for finding ID ${finding.id}.`);
  }
  return errors;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The inventory gate evaluates all independent controls deterministically.
export function validateReadinessLedger(
  plan: readonly PlanFinding[],
  findings: readonly FindingRow[],
  exceptions: readonly ExceptionRow[],
  verificationDate: string,
  registrySource: ReadinessReferenceRegistrySource,
  scopeManifest: ReadinessScopeManifest,
  evidenceVerifier?: ReadinessEvidenceVerifier,
): string[] {
  const errors: string[] = [];
  if (!calendarDate(verificationDate)) return ['Verification date is invalid.'];
  const registryBuild = buildReadinessReferenceRegistry(registrySource);
  errors.push(...registryBuild.errors);
  errors.push(...temporalEvidenceErrors(registrySource, verificationDate, evidenceVerifier));
  errors.push(...manifestErrors(scopeManifest));
  errors.push(...planRowErrors(plan));
  errors.push(...scopeInputErrors('plan', plan, scopeManifest));
  errors.push(
    ...scopeInputErrors(
      'ledger',
      findings.map((finding) => ({
        id: finding.id,
        priority: finding.priority,
        finding: finding.finding,
        requiredOutcome: finding.closeCondition,
      })),
      scopeManifest,
    ),
  );
  for (const id of duplicates(plan.map((finding) => finding.id)))
    if (validId(id)) errors.push(`Duplicate plan finding ID: ${id}.`);
  for (const row of findings) errors.push(...validateFinding(row));
  for (const id of duplicates(findings.filter((row) => validId(row.id)).map((row) => row.id)))
    errors.push(`Duplicate ledger finding ID: ${id}.`);
  const planById = new Map(
    plan
      .filter(
        (finding) =>
          validId(finding.id) && (finding.priority === 'P0' || finding.priority === 'P1'),
      )
      .map((finding) => [finding.id, finding]),
  );
  const findingById = new Map(
    findings.filter((row) => validId(row.id)).map((row) => [row.id, row]),
  );
  for (const [id, planFinding] of [...planById.entries()].sort()) {
    const finding = findingById.get(id);
    if (finding === undefined) errors.push(`Missing ledger finding ID: ${id}.`);
    else {
      if (finding.priority !== planFinding.priority)
        errors.push(`Priority mismatch for finding ID ${id}.`);
      if (finding.finding !== planFinding.finding)
        errors.push(`Finding text mismatch for finding ID ${id}.`);
      if (finding.closeCondition !== planFinding.requiredOutcome)
        errors.push(`Required outcome mismatch for finding ID ${id}.`);
    }
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
  if ('registry' in registryBuild)
    errors.push(...registryErrors(findings, exceptions, registryBuild.registry, evidenceVerifier));
  return errors;
}

async function main(): Promise<void> {
  const root = `${import.meta.dir}/..`;
  const [plan, ledger] = await Promise.all([
    readFile(`${root}/docs/superpowers/plans/2026-08-09-open-source-readiness.md`, 'utf8'),
    readFile(`${root}/docs/maintainers/readiness-ledger.md`, 'utf8'),
  ]);
  const findings = parseFindingRows(ledger);
  const evidenceTargets = readinessEvidenceTargets(findings, readinessReferenceRegistrySource);
  const evidenceVerifier = await createProductionReadinessEvidenceVerifier(
    root,
    readinessReferenceRegistrySource,
    evidenceTargets,
  );
  const errors = validateReadinessLedger(
    parsePlanFindings(plan),
    findings,
    parseExceptionRows(ledger),
    currentUtcDate(),
    readinessReferenceRegistrySource,
    readinessScopeManifest,
    evidenceVerifier,
  );
  if (errors.length > 0) {
    for (const error of errors) console.log(error);
    process.exit(1);
  }
  console.log(`OK: readiness ledger matches ${findings.length} P0/P1 plan findings.`);
}

if (import.meta.main) await main();
