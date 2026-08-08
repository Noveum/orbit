import { readFile } from 'node:fs/promises';

export interface Requirement {
  readonly source: string;
  readonly range: string;
}

export interface Resolution {
  readonly holder: string;
  readonly version: string;
}

function endOfString(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length) {
    const char = text[index] ?? '';
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === '"') return index + 1;
    index += 1;
  }
  return text.length;
}

function closesContainer(text: string, from: number): boolean {
  let index = from;
  while (index < text.length && /\s/.test(text[index] ?? '')) index += 1;
  const char = text[index] ?? '';
  return char === '}' || char === ']';
}

export function stripTrailingCommas(text: string): string {
  let out = '';
  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? '';
    if (char === '"') {
      const end = endOfString(text, index);
      out += text.slice(index, end);
      index = end;
      continue;
    }
    if (char === ',' && closesContainer(text, index + 1)) {
      index += 1;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseLock(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(stripTrailingCommas(text));
  if (!isRecord(parsed)) throw new Error('bun.lock is not an object.');
  return parsed;
}

export function splitSpecifier(specifier: string): { name: string; version: string } | null {
  const at = specifier.lastIndexOf('@');
  if (at <= 0) return null;
  return { name: specifier.slice(0, at), version: specifier.slice(at + 1) };
}

function rangesIn(block: unknown, name: string): string | null {
  if (!isRecord(block)) return null;
  const range = block[name];
  return typeof range === 'string' ? range : null;
}

export function resolutionsOf(lock: Record<string, unknown>, name: string): Resolution[] {
  const packages = lock['packages'];
  if (!isRecord(packages)) return [];
  const found: Resolution[] = [];
  for (const [holder, entry] of Object.entries(packages)) {
    if (!Array.isArray(entry)) continue;
    const specifier = entry[0];
    if (typeof specifier !== 'string') continue;
    const split = splitSpecifier(specifier);
    if (split === null || split.name !== name) continue;
    found.push({ holder, version: split.version });
  }
  return found;
}

const MANIFEST_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

const PACKAGE_FIELDS = ['dependencies', 'peerDependencies'] as const;

function labelled(source: string, field: string): string {
  return field === 'peerDependencies' ? `${source} (peer)` : source;
}

function workspaceRequirements(lock: Record<string, unknown>, name: string): Requirement[] {
  const workspaces = lock['workspaces'];
  if (!isRecord(workspaces)) return [];
  const found: Requirement[] = [];
  for (const [directory, manifest] of Object.entries(workspaces)) {
    if (!isRecord(manifest)) continue;
    const source = `${directory === '' ? '.' : directory}/package.json`;
    for (const field of MANIFEST_FIELDS) {
      const range = rangesIn(manifest[field], name);
      if (range === null) continue;
      found.push({ source: labelled(source, field), range });
    }
  }
  return found;
}

function packageRequirements(lock: Record<string, unknown>, name: string): Requirement[] {
  const packages = lock['packages'];
  if (!isRecord(packages)) return [];
  const found: Requirement[] = [];
  for (const [holder, entry] of Object.entries(packages)) {
    if (!Array.isArray(entry)) continue;
    const meta = isRecord(entry[2]) ? entry[2] : null;
    for (const field of PACKAGE_FIELDS) {
      const range = rangesIn(meta === null ? null : meta[field], name);
      if (range === null) continue;
      found.push({ source: labelled(holder, field), range });
    }
  }
  return found;
}

export function requirementsOf(lock: Record<string, unknown>, name: string): Requirement[] {
  return [...workspaceRequirements(lock, name), ...packageRequirements(lock, name)];
}

export function violations(
  name: string,
  override: string,
  resolutions: readonly Resolution[],
  requirements: readonly Requirement[],
  satisfies: (version: string, range: string) => boolean,
): string[] {
  if (resolutions.length === 0) {
    return [
      `${name} is overridden to '${override}' in the root package.json but nothing in bun.lock depends on it. Drop the stale override.`,
    ];
  }
  const versions = [...new Set(resolutions.map((entry) => entry.version))].sort();
  if (versions.length > 1) {
    const holders = resolutions.map((entry) => `${entry.holder} -> ${entry.version}`).join(', ');
    return [
      `${name} resolves to ${versions.length} versions (${versions.join(', ')}). Two copies of a package whose types cross module boundaries fail typecheck under exactOptionalPropertyTypes, and anything that compares instances or facets across the two copies is one refactor away from failing at runtime. Resolutions: ${holders}. Run bun install so the override collapses them.`,
    ];
  }
  const installed = versions[0] ?? '';
  const unmet = requirements.filter((requirement) => !satisfies(installed, requirement.range));
  return unmet.map(
    (requirement) =>
      `${name}: ${requirement.source} asks for '${requirement.range}' but the root override '${override}' installs ${installed}. bun applies an override to direct dependencies too, so a version bump left only in the manifest is silently ignored. Update the override to the same range and run bun install.`,
  );
}

export function overridesOf(manifest: unknown): Map<string, string> {
  const entries = new Map<string, string>();
  if (!isRecord(manifest)) return entries;
  const overrides = manifest['overrides'];
  if (!isRecord(overrides)) return entries;
  for (const [name, range] of Object.entries(overrides)) {
    if (typeof range === 'string') entries.set(name, range);
  }
  return entries;
}

async function main(): Promise<void> {
  const root = `${import.meta.dir}/..`;
  const manifest: unknown = JSON.parse(await readFile(`${root}/package.json`, 'utf8'));
  const overrides = overridesOf(manifest);
  if (overrides.size === 0) {
    console.log('OK: no dependency overrides declared.');
    return;
  }
  const lock = parseLock(await readFile(`${root}/bun.lock`, 'utf8'));
  const problems: string[] = [];
  for (const [name, override] of overrides) {
    problems.push(
      ...violations(
        name,
        override,
        resolutionsOf(lock, name),
        requirementsOf(lock, name),
        (version, range) => Bun.semver.satisfies(version, range),
      ),
    );
  }
  if (problems.length > 0) {
    for (const problem of problems) console.log(problem);
    console.log(`\n${problems.length} override problem(s) in bun.lock.`);
    process.exit(1);
  }
  console.log(`OK: ${overrides.size} overridden package(s) each resolve to one version.`);
}

if (import.meta.main) await main();
