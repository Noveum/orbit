import { spawnSync } from 'node:child_process';

const FULL_COMMIT = /^[a-f0-9]{40}$/;
const ZERO_OBJECT_ID = '0'.repeat(40);
const REGULAR_FILE_MODE = '100644';
const MAX_ARTIFACT_BYTES = 1_000_000;
const MAX_CHANGED_FILES = 256;
const GIT_MODES = new Set(['000000', '100644', '100755', '120000', '160000']);
const GOVERNED_FILES = new Set([
  'docs/maintainers/readiness-ledger.md',
  'docs/maintainers/readiness-scope-audit.json',
  'docs/superpowers/plans/2026-08-09-open-source-readiness.md',
  'scripts/readiness-scope-manifest.json',
  'scripts/readiness-reference-registry.json',
]);
const UTF8 = new TextDecoder('utf-8', { fatal: true });

function safePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith('/') &&
    !path.includes('\0') &&
    path.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')
  );
}

function gitBytes(root: string, args: readonly string[]): Buffer {
  const result = spawnSync('git', args, { cwd: root });
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout))
    throw new Error('Trusted scope policy Git operation failed.');
  return result.stdout;
}

function decoded(bytes: Uint8Array): string {
  try {
    return UTF8.decode(bytes);
  } catch {
    throw new Error('Trusted scope policy artifact is invalid.');
  }
}

function validDiffShape(
  oldMode: string,
  newMode: string,
  oldObjectId: string,
  newObjectId: string,
  status: string,
): boolean {
  if (!(GIT_MODES.has(oldMode) && GIT_MODES.has(newMode))) return false;
  if (status === 'A')
    return (
      oldMode === '000000' &&
      newMode !== '000000' &&
      oldObjectId === ZERO_OBJECT_ID &&
      newObjectId !== ZERO_OBJECT_ID
    );
  if (status === 'D')
    return (
      oldMode !== '000000' &&
      newMode === '000000' &&
      oldObjectId !== ZERO_OBJECT_ID &&
      newObjectId === ZERO_OBJECT_ID
    );
  return (
    (status === 'M' || status === 'T') &&
    oldMode !== '000000' &&
    newMode !== '000000' &&
    oldObjectId !== ZERO_OBJECT_ID &&
    newObjectId !== ZERO_OBJECT_ID
  );
}

function validChangedPath(path: string): boolean {
  return path.length <= 1_024 && !/[\p{Cc}]/u.test(path) && safePath(path);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Raw Git records require coupled byte, mode, object, status, and path validation.
export function parseTrustedRawGitDiff(bytes: Uint8Array): string[] {
  let text: string;
  try {
    text = UTF8.decode(bytes);
  } catch {
    throw new Error('Trusted scope policy Git diff is invalid.');
  }
  if (text.length === 0) return [];
  const fields = text.split('\0');
  if (fields.pop() !== '' || fields.length % 2 !== 0)
    throw new Error('Trusted scope policy Git diff is invalid.');
  const files: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < fields.length; index += 2) {
    const metadata = fields[index] ?? '';
    const path = fields[index + 1] ?? '';
    const match = /^:(\d{6}) (\d{6}) ([a-f0-9]{40}) ([a-f0-9]{40}) ([ADMT])$/.exec(metadata);
    if (
      match === null ||
      !validDiffShape(
        match[1] ?? '',
        match[2] ?? '',
        match[3] ?? '',
        match[4] ?? '',
        match[5] ?? '',
      ) ||
      !validChangedPath(path) ||
      seen.has(path) ||
      files.length >= MAX_CHANGED_FILES
    )
      throw new Error('Trusted scope policy Git diff is invalid.');
    if (
      GOVERNED_FILES.has(path) &&
      !(match[1] === REGULAR_FILE_MODE && match[2] === REGULAR_FILE_MODE && match[5] === 'M')
    )
      throw new Error('Trusted scope policy governed Git diff is invalid.');
    seen.add(path);
    files.push(path);
  }
  return files;
}

export function readTrustedGitChangedFiles(
  root: string,
  baseCommit: string,
  headCommit: string,
): string[] {
  if (!(FULL_COMMIT.test(baseCommit) && FULL_COMMIT.test(headCommit)))
    throw new Error('Trusted scope policy Git diff is invalid.');
  return parseTrustedRawGitDiff(
    gitBytes(root, [
      'diff-tree',
      '-r',
      '--no-commit-id',
      '--raw',
      '--no-abbrev',
      '-z',
      '--no-renames',
      baseCommit,
      headCommit,
    ]),
  );
}

export function readTrustedGitArtifact(root: string, commit: string, path: string): string {
  if (!(FULL_COMMIT.test(commit) && safePath(path)))
    throw new Error('Trusted scope policy artifact is invalid.');
  const tree = decoded(gitBytes(root, ['ls-tree', '-z', '--full-tree', commit, '--', path]));
  const entries = tree.split('\0').filter((entry) => entry.length > 0);
  const entry = entries.length === 1 ? entries[0] : undefined;
  const separator = entry?.indexOf('\t') ?? -1;
  const metadata = separator >= 0 ? entry?.slice(0, separator) : undefined;
  const entryPath = separator >= 0 ? entry?.slice(separator + 1) : undefined;
  const match = /^(\d{6}) (\S+) ([a-f0-9]{40})$/.exec(metadata ?? '');
  if (match?.[1] !== REGULAR_FILE_MODE || match[2] !== 'blob' || entryPath !== path)
    throw new Error('Trusted scope policy artifact is invalid.');
  const objectId = match[3] ?? '';
  const sizeText = decoded(gitBytes(root, ['cat-file', '-s', objectId])).trim();
  const size = Number(sizeText);
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_ARTIFACT_BYTES)
    throw new Error('Trusted scope policy artifact is invalid.');
  const bytes = gitBytes(root, ['cat-file', 'blob', objectId]);
  if (bytes.byteLength !== size || bytes.includes(0))
    throw new Error('Trusted scope policy artifact is invalid.');
  return decoded(bytes);
}
