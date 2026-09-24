import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

const workflowSchema = z.object({
  jobs: z.object({
    publish: z.object({ steps: z.array(z.object({ name: z.string(), run: z.string() })) }),
  }),
});

test.each([
  { refType: 'branch', ref: 'main', architectures: ['amd64', 'arm64'], release: '', ok: true },
  {
    refType: 'tag',
    ref: 'containers-2026.09.24',
    architectures: ['amd64', 'arm64'],
    release: '2026.09.24',
    ok: true,
  },
  {
    refType: 'tag',
    ref: 'containers-2026.09.24-rc.4',
    architectures: ['amd64', 'arm64'],
    release: '2026.09.24-rc.4',
    ok: true,
  },
  { refType: 'tag', ref: 'containers-latest', architectures: [], release: '', ok: false },
  {
    refType: 'tag',
    ref: 'containers-2026.09.24',
    architectures: ['amd64'],
    release: '',
    ok: false,
  },
])('container manifest publication validates $ref and platform coverage', async (fixture) => {
  const workflow = workflowSchema.parse(
    Bun.YAML.parse(await readFile('.github/workflows/container-images.yml', 'utf8')),
  );
  const script = workflow.jobs.publish.steps.find(
    (step) => step.name === 'Publish multi-platform manifests',
  )?.run;
  if (script === undefined) throw new Error('Missing manifest publication step');
  const directory = await mkdtemp(join(tmpdir(), 'orbit-manifest-test-'));
  const callsFile = join(directory, 'calls.jsonl');
  try {
    await writeFile(callsFile, '');
    await writeFile(
      join(directory, 'docker'),
      `#!${process.execPath}
const args = process.argv.slice(2);
await Bun.write(Bun.file(process.env.CALLS), (await Bun.file(process.env.CALLS).text()) + JSON.stringify(args) + '\\n');
if (args[0] === 'login') await Bun.stdin.text();
if (args[0] === 'manifest' && args[1] === 'inspect') console.log(JSON.stringify({manifests: JSON.parse(process.env.ARCHITECTURES).map(architecture => ({platform:{os:'linux',architecture}}))}));
`,
      { mode: 0o755 },
    );
    const child = Bun.spawn(['bash', '-c', script], {
      env: {
        PATH: `${directory}:${process.env['PATH'] ?? ''}`,
        CALLS: callsFile,
        ARCHITECTURES: JSON.stringify(fixture.architectures),
        GITHUB_REF_TYPE: fixture.refType,
        GITHUB_REF_NAME: fixture.ref,
        GITHUB_SHA: 'test-commit',
        GITHUB_ACTOR: 'test-publisher',
        REGISTRY_TOKEN: 'fixture-token',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [code] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code === 0).toBe(fixture.ok);
    const calls = (await readFile(callsFile, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => z.array(z.string()).parse(JSON.parse(line)));
    const releases = calls.filter(
      (args) => args[0] === 'manifest' && args[1] === 'push' && !args[2]?.includes(':sha-'),
    );
    expect(releases).toEqual(
      fixture.release
        ? ['runtime', 'gateway', 'bucket'].map((component) => [
            'manifest',
            'push',
            `ghcr.io/noveum/orbit-${component}:${fixture.release}`,
          ])
        : [],
    );
    if (fixture.release) {
      const firstRelease = calls.findIndex((args) => args[2]?.endsWith(`:${fixture.release}`));
      expect(calls.slice(0, firstRelease).filter((args) => args[1] === 'inspect')).toHaveLength(3);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
