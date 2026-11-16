import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

async function check(content: string, name: string) {
  const directory = await mkdtemp(join(root, 'apps/web/src/format-policy-fixture-'));
  try {
    const path = join(directory, name);
    await writeFile(path, content);
    const child = Bun.spawn(
      [process.execPath, 'node_modules/@biomejs/biome/bin/biome', 'check', path],
      { cwd: root, stdout: 'pipe', stderr: 'pipe' },
    );
    const output = await new Response(child.stdout).text();
    const errors = await new Response(child.stderr).text();
    return { exitCode: await child.exited, diagnostics: output + errors };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('keeps existing Markdown and YAML formatting outside the format gate', async () => {
  const markdown = await check('| A | B |\n| --- | --- |\n| value | value |\n', 'policy.md');
  const yaml = await check('name:   fixture\nitems: [one,two]\n', 'policy.yml');
  expect(markdown.exitCode).toBe(0);
  expect(yaml.exitCode).toBe(0);
}, 20_000);

test('continues to reject unsafe TypeScript', async () => {
  const result = await check('export const value: any = 1;\n', 'policy.ts');
  expect(result.exitCode).toBe(1);
  expect(result.diagnostics).toContain('noExplicitAny');
}, 20_000);

test('rejects component factories outside test utilities', async () => {
  const result = await check(
    'export function Parent() { function Child() { const value = useState(0); return <div>{value}</div>; } return <Child />; }\n',
    'policy.tsx',
  );
  expect(result.exitCode).toBe(1);
  expect(result.diagnostics).toContain('noComponentHookFactories');
}, 20_000);
