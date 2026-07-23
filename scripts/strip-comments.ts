import ts from 'typescript';

export interface CommentRange {
  pos: number;
  end: number;
}

export interface ScanResult {
  remove: CommentRange[];
  kept: number;
}

interface Finding {
  file: string;
  line: number;
  text: string;
}

interface Stats {
  totalRemoved: number;
  changedFiles: number;
  totalKept: number;
}

interface Span {
  start: number;
  end: number;
}

const args: string[] = process.argv.slice(2);
const CHECK = args.some((a) => a === '--check' || a === '--dry-run' || a === '--dry');
const SELFTEST = args.includes('--selftest');

export function keep(raw: string): boolean {
  const isLine = raw.startsWith('//');
  if (isLine && raw.startsWith('///') && /^<(reference|amd-)/.test(raw.slice(3).trim())) {
    return true;
  }
  if (!isLine && raw.startsWith('/*!')) return true;
  const inner = isLine ? raw.replace(/^\/\/+/, '') : raw.slice(2, -2);
  const t = inner.trim().replace(/^\*+\s*/, '');

  if (/^@(ts-ignore|ts-expect-error|ts-nocheck|ts-check)\b/.test(t)) return true;
  if (/^eslint-(disable|enable)(-next-line|-line)?\b/.test(t)) return true;
  if (/^biome-ignore\b/.test(t)) return true;
  if (/^prettier-ignore\b/.test(t)) return true;
  if (/^@(jsx|jsxImportSource|jsxRuntime|jsxFrag)\b/.test(t)) return true;
  if (/^#\s*source(MappingURL|URL)\b/.test(t)) return true;
  if (/^@vite-ignore\b/.test(t)) return true;
  if (/^[#@]__(PURE|NO_SIDE_EFFECTS)__/.test(t)) return true;
  if (/^(istanbul|c8|v8)\s+ignore\b/.test(t)) return true;
  if (/^@(license|preserve)\b/.test(t)) return true;
  if (/webpack(ChunkName|Mode|Prefetch|Preload|Include|Exclude|Ignore)/.test(t)) return true;

  if (!isLine && /^(eslint-env|eslint\s|globals?\s|exported\b)/.test(t)) return true;

  return false;
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.(c|m)?ts$/.test(file)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

export function tsComments(file: string, text: string): ScanResult {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  const seen = new Set<string>();
  const found: CommentRange[] = [];
  const jsxSpans: [number, number][] = [];
  const add = (ranges: readonly ts.CommentRange[] | undefined): void => {
    for (const r of ranges ?? []) {
      const key = `${r.pos}:${r.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ pos: r.pos, end: r.end });
    }
  };
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.JsxText) {
      jsxSpans.push([node.getFullStart(), node.getEnd()]);
      return;
    }
    const children = node.getChildren(sf);
    if (children.length === 0) {
      add(ts.getLeadingCommentRanges(text, node.getFullStart()));
      add(ts.getTrailingCommentRanges(text, node.getEnd()));
      return;
    }
    for (const c of children) visit(c);
  };
  visit(sf);

  const inJsxText = (r: CommentRange): boolean => jsxSpans.some(([s, e]) => r.pos < e && r.end > s);
  const remove: CommentRange[] = [];
  let kept = 0;
  for (const r of found) {
    if (inJsxText(r)) continue;
    if (keep(text.slice(r.pos, r.end))) kept++;
    else remove.push(r);
  }
  return { remove, kept };
}

export function keepSwift(raw: string): boolean {
  const isLine = raw.startsWith('//');
  if (!isLine && raw.startsWith('/*!')) return true;
  const inner = isLine ? raw.replace(/^\/\/+/, '') : raw.slice(2, -2);
  const t = inner.trim().replace(/^\*+\s*/, '');
  if (/^swift-tools-version\b/.test(t)) return true;
  if (/^swiftlint:/.test(t)) return true;
  if (/^swift-format\b/.test(t)) return true;
  if (/^sourcery:/.test(t)) return true;
  return false;
}

interface SwiftCodeContext {
  kind: 'code';
  interp: boolean;
  paren: number;
}

interface SwiftStringContext {
  kind: 'string';
  raw: boolean;
  hashes: number;
  multiline: boolean;
}

type SwiftContext = SwiftCodeContext | SwiftStringContext;

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: single pass scanner over Swift source, splitting it would spread the string state
export function swiftComments(text: string): ScanResult {
  const n = text.length;
  const stack: SwiftContext[] = [{ kind: 'code', interp: false, paren: 0 }];
  const found: CommentRange[] = [];
  const has = (i: number, s: string): boolean => text.startsWith(s, i);
  let i = 0;
  while (i < n) {
    const ctx = stack.at(-1);
    if (ctx === undefined) break;
    if (ctx.kind === 'string') {
      const s = ctx;
      const c = text[i];
      if (!s.raw && c === '\\') {
        if (text[i + 1] === '(') {
          stack.push({ kind: 'code', interp: true, paren: 0 });
          i += 2;
        } else {
          i += 2;
        }
        continue;
      }
      if (s.raw && c === '\\') {
        let j = i + 1;
        let h = 0;
        while (text[j] === '#') {
          h++;
          j++;
        }
        if (h === s.hashes && text[j] === '(') {
          stack.push({ kind: 'code', interp: true, paren: 0 });
          i = j + 1;
          continue;
        }
        i++;
        continue;
      }
      if (c === '"') {
        if (s.multiline) {
          if (has(i, '"""')) {
            const tail = '#'.repeat(s.hashes);
            if (!s.raw || has(i + 3, tail)) {
              stack.pop();
              i += 3 + s.hashes;
              continue;
            }
          }
          i++;
          continue;
        }
        const tail = '#'.repeat(s.hashes);
        if (!s.raw || has(i + 1, tail)) {
          stack.pop();
          i += 1 + s.hashes;
          continue;
        }
        i++;
        continue;
      }
      i++;
      continue;
    }

    const c = text[i];
    if (c === '#') {
      let j = i;
      let h = 0;
      while (text[j] === '#') {
        h++;
        j++;
      }
      if (text[j] === '"') {
        const ml = has(j, '"""');
        stack.push({ kind: 'string', raw: true, hashes: h, multiline: ml });
        i = j + (ml ? 3 : 1);
        continue;
      }
      i = j;
      continue;
    }
    if (c === '"') {
      const ml = has(i, '"""');
      stack.push({ kind: 'string', raw: false, hashes: 0, multiline: ml });
      i += ml ? 3 : 1;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      const start = i;
      i += 2;
      while (i < n && text[i] !== '\n') i++;
      found.push({ pos: start, end: i });
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const start = i;
      i += 2;
      let depth = 1;
      while (i < n && depth > 0) {
        if (text[i] === '/' && text[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (text[i] === '*' && text[i + 1] === '/') {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      found.push({ pos: start, end: i });
      continue;
    }
    if (ctx.interp) {
      if (c === '(') ctx.paren++;
      else if (c === ')') {
        if (ctx.paren === 0) {
          stack.pop();
          i++;
          continue;
        }
        ctx.paren--;
      }
    }
    i++;
  }

  const remove: CommentRange[] = [];
  let kept = 0;
  for (const r of found) {
    if (keepSwift(text.slice(r.pos, r.end))) kept++;
    else remove.push(r);
  }
  return { remove, kept };
}

export function htmlComments(text: string): ScanResult {
  const remove: CommentRange[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (text.startsWith('<!--', i)) {
      const start = i;
      let j = i + 4;
      while (j < n && !text.startsWith('-->', j)) j++;
      const end = Math.min(n, j + 3);
      remove.push({ pos: start, end });
      i = end;
      continue;
    }
    i++;
  }
  return { remove, kept: 0 };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: single pass scanner over CSS source, splitting it would spread the string state
export function cssComments(text: string): ScanResult {
  const remove: CommentRange[] = [];
  let kept = 0;
  let i = 0;
  const n = text.length;
  let str: string | null = null;
  while (i < n) {
    const c = text[i];
    if (str !== null) {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === str) str = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      str = c;
      i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const start = i;
      let j = i + 2;
      while (j < n && !(text[j] === '*' && text[j + 1] === '/')) j++;
      const end = Math.min(n, j + 2);
      if (text.slice(start, end).startsWith('/*!')) kept++;
      else remove.push({ pos: start, end });
      i = end;
      continue;
    }
    i++;
  }
  return { remove, kept };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: single pass scanner over JSONC source, splitting it would spread the string state
export function jsoncComments(text: string): ScanResult {
  const remove: CommentRange[] = [];
  let i = 0;
  const n = text.length;
  let str = false;
  while (i < n) {
    const c = text[i];
    if (str) {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '"') str = false;
      i++;
      continue;
    }
    if (c === '"') {
      str = true;
      i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const start = i;
      let j = i + 2;
      while (j < n && !(text[j] === '*' && text[j + 1] === '/')) j++;
      const end = Math.min(n, j + 2);
      remove.push({ pos: start, end });
      i = end;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      const start = i;
      let j = i + 2;
      while (j < n && text[j] !== '\n') j++;
      remove.push({ pos: start, end: j });
      i = j;
      continue;
    }
    i++;
  }
  return { remove, kept: 0 };
}

function keepYaml(t: string): boolean {
  if (/^yaml-language-server\b/.test(t)) return true;
  if (/^yamllint\b/.test(t)) return true;
  return false;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: single pass scanner over one YAML line, splitting it would spread the quote state
function yamlCommentAt(line: string, quote: string | null): { at: number; quote: string | null } {
  let str = quote;
  let prevWs = true;
  for (let k = 0; k < line.length; k++) {
    const c = line[k];
    if (str === '"') {
      if (c === '\\') {
        k++;
        prevWs = false;
        continue;
      }
      if (c === '"') str = null;
      prevWs = false;
      continue;
    }
    if (str === "'") {
      if (c === "'" && line[k + 1] === "'") {
        k++;
        prevWs = false;
        continue;
      }
      if (c === "'") str = null;
      prevWs = false;
      continue;
    }
    if (c === '"' || c === "'") {
      str = c;
      prevWs = false;
      continue;
    }
    if (c === '#' && prevWs) return { at: k, quote: str };
    prevWs = c === ' ' || c === '\t';
  }
  return { at: -1, quote: str };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: line walker carrying block scalar and quote state, splitting it would spread that state
export function yamlComments(text: string): ScanResult {
  const remove: CommentRange[] = [];
  let kept = 0;
  const lines = text.split('\n');
  let pos = 0;
  let blockIndent: number | null = null;
  let str: string | null = null;
  for (const line of lines) {
    const lineStart = pos;
    pos += line.length + 1;
    const firstNonWs = line.search(/\S/);
    const isBlank = firstNonWs === -1;
    const indent = isBlank ? 0 : firstNonWs;
    if (str === null && blockIndent !== null) {
      if (isBlank || indent > blockIndent) continue;
      blockIndent = null;
    }
    if (str === null && isBlank) continue;
    const scanned = yamlCommentAt(line, str);
    const commentAt = scanned.at;
    str = scanned.quote;
    if (str === null) {
      const code = (commentAt === -1 ? line : line.slice(0, commentAt)).trimEnd();
      if (/(?:^|\s)[|>](?:[1-9][+-]?|[+-][1-9]?)?$/.test(code)) blockIndent = indent;
    }
    if (commentAt === -1) continue;
    const inner = line.slice(commentAt + 1).trim();
    if (keepYaml(inner)) {
      kept++;
      continue;
    }
    remove.push({ pos: lineStart + commentAt, end: lineStart + line.length });
  }
  return { remove, kept };
}

function expand(text: string, pos: number, end: number): Span {
  let ls = pos;
  while (ls > 0 && text[ls - 1] !== '\n') ls--;
  let le = end;
  while (le < text.length && text[le] !== '\n') le++;
  if (/^[ \t]*$/.test(text.slice(ls, pos)) && /^[ \t]*$/.test(text.slice(end, le))) {
    return { start: ls, end: le < text.length ? le + 1 : le };
  }
  return { start: pos, end };
}

export function build(text: string, ranges: readonly CommentRange[]): string {
  const exp = ranges.map((r) => expand(text, r.pos, r.end));
  exp.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Span[] = [];
  for (const r of exp) {
    const last = merged.at(-1);
    if (last !== undefined && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  let out = '';
  let cursor = 0;
  for (const r of merged) {
    out += text.slice(cursor, r.start);
    cursor = r.end;
  }
  return out + text.slice(cursor);
}

function tidyText(s: string): string {
  return s
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\s+$/, '\n');
}

function lineOf(text: string, pos: number): number {
  let line = 1;
  for (let i = 0; i < pos; i++) if (text[i] === '\n') line++;
  return line;
}

function snippet(text: string, r: CommentRange): string {
  const first = (text.slice(r.pos, r.end).split('\n')[0] ?? '').trim();
  return first.length > 80 ? `${first.slice(0, 77)}...` : first;
}

export function scan(file: string, text: string): ScanResult {
  const ext = file.slice(file.lastIndexOf('.'));
  if (ext === '.swift') return swiftComments(text);
  if (ext === '.html' || ext === '.htm') return htmlComments(text);
  if (ext === '.css') return cssComments(text);
  if (ext === '.json' || ext === '.jsonc') return jsoncComments(text);
  if (ext === '.yml' || ext === '.yaml') return yamlComments(text);
  return tsComments(file, text);
}

interface SelftestCase {
  name: string;
  src: string;
  remove: number;
  kept: number;
}

function selftest(): void {
  const cases: SelftestCase[] = [
    {
      name: 'url in string + trailing comment',
      src: 'let u = "https://x.com" // c',
      remove: 1,
      kept: 0,
    },
    {
      name: 'raw string with slashes',
      src: 'let r = #"a // b /* c */"#',
      remove: 0,
      kept: 0,
    },
    {
      name: 'interpolation then string content',
      src: 'let s = "\\(a)//x"',
      remove: 0,
      kept: 0,
    },
    {
      name: 'block comment inside interpolation',
      src: 'let s = "\\(a /* n */)"',
      remove: 1,
      kept: 0,
    },
    {
      name: 'multiline string with fake comment',
      src: 'let m = """\n// not a comment\n"""',
      remove: 0,
      kept: 0,
    },
    {
      name: 'nested block comment',
      src: '/* a /* b */ c */ let x = 1',
      remove: 1,
      kept: 0,
    },
    {
      name: 'doc comment stripped',
      src: '/// doc\nfunc f() {}',
      remove: 1,
      kept: 0,
    },
    {
      name: 'tools-version kept',
      src: '// swift-tools-version:6.0\nimport X',
      remove: 0,
      kept: 1,
    },
    {
      name: 'MARK stripped',
      src: '// MARK: - Section\nlet x = 1',
      remove: 1,
      kept: 0,
    },
    {
      name: 'swiftlint kept',
      src: '// swiftlint:disable foo\nlet x = 1',
      remove: 0,
      kept: 1,
    },
    {
      name: 'division not a comment',
      src: 'let a = 1 / 2 // c',
      remove: 1,
      kept: 0,
    },
    {
      name: 'raw multiline string',
      src: 'let m = #"""\n// nope\n"""#\nlet y = 1 // yes',
      remove: 1,
      kept: 0,
    },
  ];
  let failed = 0;
  for (const t of cases) {
    const { remove, kept } = swiftComments(t.src);
    const ok = remove.length === t.remove && kept === t.kept;
    if (!ok) {
      failed++;
      console.error(
        `FAIL ${t.name}: got remove=${remove.length} kept=${kept}, want remove=${t.remove} kept=${t.kept}`,
      );
    }
  }
  const url = 'let u = "https://x.com" // c';
  const { remove } = swiftComments(url);
  if (!build(url, remove).startsWith('let u = "https://x.com"')) {
    failed++;
    console.error('FAIL url integrity');
  }
  if (failed) {
    console.error(`\nselftest: ${failed} failure(s)`);
    process.exit(1);
  }
  console.log(`selftest: all ${cases.length} cases passed`);
}

function buildSummary(findings: readonly Finding[], stats: Stats): string {
  const { totalRemoved, changedFiles, totalKept } = stats;
  const server = process.env['GITHUB_SERVER_URL'] ?? 'https://github.com';
  const repo = process.env['GITHUB_REPOSITORY'];
  const sha = process.env['GITHUB_SHA'];
  const fileCell = (f: string, line: number): string => {
    if (repo === undefined || sha === undefined) return `\`${f}\``;
    const href = `${server}/${repo}/blob/${sha}/${f.split('/').map(encodeURIComponent).join('/')}#L${line}`;
    return `[\`${f}\`](${href})`;
  };
  const codeCell = (s: string): string =>
    s.replace(/[\\|]/g, '\\$&').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rows = findings
    .map((x) => `| ${fileCell(x.file, x.line)} | ${x.line} | <code>${codeCell(x.text)}</code> |`)
    .join('\n');
  return [
    `## ❌ ${totalRemoved} disallowed code comment${totalRemoved === 1 ? '' : 's'}`,
    '',
    `Comments are not allowed in code - found in **${changedFiles}** file${changedFiles === 1 ? '' : 's'} (**${totalKept}** functional directive${totalKept === 1 ? '' : 's'} were ignored). Remove them locally with:`,
    '',
    '```bash',
    'bun run strip-comments',
    '```',
    '',
    '| File | Line | Comment |',
    '| --- | --- | --- |',
    rows,
    '',
  ].join('\n');
}

async function appendToFile(path: string, contents: string): Promise<void> {
  const file = Bun.file(path);
  const existing = (await file.exists()) ? await file.text() : '';
  await Bun.write(path, existing + contents);
}

async function reportGithub(findings: readonly Finding[], stats: Stats): Promise<void> {
  if (process.env['GITHUB_ACTIONS'] !== 'true') return;
  const escData = (s: string): string =>
    s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const escProp = (s: string): string => escData(s).replace(/,/g, '%2C').replace(/:/g, '%3A');
  for (const x of findings) {
    console.log(
      `::error file=${escProp(x.file)},line=${x.line},title=Disallowed comment::${escData(x.text)}`,
    );
  }
  const out = process.env['GITHUB_STEP_SUMMARY'];
  if (out === undefined || out.length === 0) return;
  const md = findings.length
    ? buildSummary(findings, stats)
    : '## ✅ No disallowed code comments\n\nEvery tracked file is comment-free (functional directives ignored).\n';
  await appendToFile(out, `${md}\n`);
}

function trackedFiles(): string[] {
  const listed = Bun.spawnSync([
    'git',
    'ls-files',
    '*.swift',
    '*.html',
    '*.htm',
    '*.ts',
    '*.tsx',
    '*.js',
    '*.jsx',
    '*.mjs',
    '*.cjs',
    '*.css',
    '*.json',
    '*.jsonc',
    '*.yml',
    '*.yaml',
  ]);
  if (listed.exitCode !== 0) {
    throw new Error(`git ls-files failed: ${listed.stderr.toString().trim()}`);
  }
  return listed.stdout
    .toString()
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((f) => !/(^|\/)package-lock\.json$/.test(f));
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: straight line driver over every tracked file, splitting it would only move branches
async function main(): Promise<void> {
  const files = trackedFiles();

  let changedFiles = 0;
  let totalRemoved = 0;
  let totalKept = 0;
  const findings: Finding[] = [];

  for (const f of files) {
    const source = Bun.file(f);
    if (!(await source.exists())) continue;
    const text = await source.text();
    const ext = f.slice(f.lastIndexOf('.'));
    const { remove, kept } = scan(f, text);
    totalKept += kept;
    if (remove.length === 0) continue;
    changedFiles++;
    totalRemoved += remove.length;
    if (CHECK) {
      for (const r of remove)
        findings.push({
          file: f,
          line: lineOf(text, r.pos),
          text: snippet(text, r),
        });
      continue;
    }
    let out = build(text, remove);
    if (ext === '.css' || ext === '.html' || ext === '.htm') out = tidyText(out);
    if (out !== text) await Bun.write(f, out);
  }

  if (CHECK) {
    for (const x of findings) console.log(`${x.file}:${x.line}: ${x.text}`);
    await reportGithub(findings, { totalRemoved, changedFiles, totalKept });
    console.log(
      `\n${totalRemoved} disallowed comment(s) in ${changedFiles} file(s) (${totalKept} directive(s) ignored).`,
    );
    if (totalRemoved > 0) {
      console.log('Code comments are not allowed. Run `bun run strip-comments` to remove them.');
      process.exit(1);
    }
    console.log('OK: no disallowed comments found.');
  } else {
    console.log(`scanned ${files.length} files`);
    console.log(`changed: ${changedFiles} files`);
    console.log(`comments removed: ${totalRemoved}`);
    console.log(`directives/license kept: ${totalKept}`);
  }
}

if (import.meta.main) {
  if (SELFTEST) selftest();
  else await main();
}
