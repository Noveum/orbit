import { readFile } from 'node:fs/promises';

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.ico',
  '.icns',
  '.pdf',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp4',
  '.webm',
  '.mov',
  '.zip',
  '.gz',
  '.node',
  '.wasm',
]);

const TAB = 9;
const NEWLINE = 10;
const CARRIAGE_RETURN = 13;
const FIRST_PRINTABLE = 32;

export function extensionOf(file: string): string {
  const dot = file.lastIndexOf('.');
  const slash = file.lastIndexOf('/');
  return dot > slash ? file.slice(dot).toLowerCase() : '';
}

export function isTextSource(file: string): boolean {
  return !BINARY_EXTENSIONS.has(extensionOf(file));
}

export interface ControlByte {
  readonly offset: number;
  readonly line: number;
  readonly byte: number;
}

export function controlBytes(data: Uint8Array): ControlByte[] {
  const found: ControlByte[] = [];
  let line = 1;
  for (const [offset, byte] of data.entries()) {
    if (byte === NEWLINE) {
      line += 1;
      continue;
    }
    if (byte === TAB || byte === CARRIAGE_RETURN || byte >= FIRST_PRINTABLE) continue;
    found.push({ offset, line, byte });
  }
  return found;
}

export function describe(file: string, entry: ControlByte): string {
  const code = `0x${entry.byte.toString(16).padStart(2, '0')}`;
  return `${file}:${entry.line}: control byte ${code} at offset ${entry.offset}`;
}

function trackedFiles(): string[] {
  const listed = Bun.spawnSync(['git', 'ls-files', '-z']);
  if (listed.exitCode !== 0) {
    throw new Error(`git ls-files failed: ${listed.stderr.toString().trim()}`);
  }
  return listed.stdout
    .toString()
    .split('\0')
    .filter((entry) => entry.length > 0);
}

async function main(): Promise<void> {
  const files = trackedFiles().filter(isTextSource);
  const problems: string[] = [];

  for (const file of files) {
    const data = await readFile(file).catch(() => null);
    if (data === null) continue;
    for (const entry of controlBytes(data)) problems.push(describe(file, entry));
  }

  if (problems.length > 0) {
    for (const problem of problems) console.log(problem);
    console.log(
      `\n${problems.length} control byte(s) in tracked source. A stray NUL or control character makes the file binary to grep and to most tooling, and it survives review because the code still compiles.`,
    );
    process.exit(1);
  }
  console.log(`OK: no control bytes in ${files.length} tracked source files.`);
}

if (import.meta.main) await main();
