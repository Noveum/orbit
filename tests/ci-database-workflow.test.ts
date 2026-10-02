import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { YAML } from 'bun';

const workflow = YAML.parse(
  await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'),
) as {
  jobs: {
    test: {
      env: Record<string, string>;
      steps: { run?: string }[];
    };
  };
};

describe('CI database preparation', () => {
  test('releases the database and package templates before running the suites', () => {
    const commands = workflow.jobs.test.steps.flatMap((step) =>
      step.run === undefined ? [] : [step.run],
    );
    const release = commands.indexOf('bun run db:release');
    const templates = commands.indexOf('bun run db:test-setup');
    const suites = commands.indexOf('bun run test');

    expect(release).toBeGreaterThanOrEqual(0);
    expect(templates).toBeGreaterThan(release);
    expect(suites).toBeGreaterThan(templates);
    expect(commands.join('\n')).not.toMatch(/(?:drizzle-kit\s+push|@orbit\/db['"]\s+push)/u);
  });

  test('isolates package suites in a lane unique to the workflow attempt', () => {
    expect(workflow.jobs.test.env['ORBIT_TEST_LANE']).toContain(`\${{ github.run_id }}`);
    expect(workflow.jobs.test.env['ORBIT_TEST_LANE']).toContain(`\${{ github.run_attempt }}`);
  });
});
