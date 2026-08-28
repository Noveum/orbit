import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { YAML } from 'bun';

const workflowPath = new URL('../.github/workflows/auto-release.yml', import.meta.url);

const scriptPath = new URL('../scripts/release-notes.ts', import.meta.url);

const workflowSource = await readFile(workflowPath, 'utf8');
const script = readFileSync(scriptPath, 'utf8');
const parsedWorkflow = YAML.parse(workflowSource) as {
  jobs: {
    'tag-and-release': {
      steps: Array<{
        name?: string;
        id?: string;
        env?: Record<string, string>;
        run?: string;
        with?: Record<string, unknown>;
      }>;
    };
  };
};

describe('automated release workflow contract', () => {
  test('contains every release step as parsed YAML', () => {
    const steps = parsedWorkflow.jobs['tag-and-release'].steps;

    expect(steps.some((step) => step.id === 'target')).toBe(true);
    expect(steps.some((step) => step.id === 'build_notes')).toBe(true);
    expect(steps.some((step) => step.id === 'release_tag')).toBe(true);
    expect(steps.some((step) => step.name === 'Publish or recover GitHub release')).toBe(true);
  });
  test('connects every generator output to the workflow', () => {
    expect(script).toContain("writeGitHubOutput('tag', selectedTag.tag)");
    expect(script).toContain("writeGitHubOutput('tag_action', selectedTag.action)");
    expect(script).toContain("'release_target_sha',");

    const releaseTagStep = parsedWorkflow.jobs['tag-and-release'].steps.find(
      (step) => step.id === 'release_tag',
    );

    expect(releaseTagStep?.env?.['TAG']).toBe(`\${{ steps.build_notes.outputs.tag }}`);
    expect(releaseTagStep?.env?.['TAG_ACTION']).toBe(
      `\${{ steps.build_notes.outputs.tag_action }}`,
    );
    expect(releaseTagStep?.env?.['RELEASE_TARGET_SHA']).toBe(
      `\${{ steps.build_notes.outputs.release_target_sha }}`,
    );

    expect(workflowSource).toMatch(
      /RELEASE_TARGET_SHA:\s*\$\{\{\s*steps\.build_notes\.outputs\.release_target_sha\s*\}\}/,
    );
  });

  test('passes the selected tag into the publish step', () => {
    expect(workflowSource).toMatch(/TAG:\s*\$\{\{\s*steps\.release_tag\.outputs\.tag\s*\}\}/);
    expect(workflowSource).toContain('echo "tag=$TAG" >> "$GITHUB_OUTPUT"');
  });

  test('keeps checkout credentials disabled and scopes mutation credentials', () => {
    expect(workflowSource).toContain('persist-credentials: false');
    expect(workflowSource).toMatch(/GH_TOKEN:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/);
    expect(workflowSource).toContain(
      `REPOSITORY_URL="https://x-access-token:\${GH_TOKEN}@github.com/\${GITHUB_REPOSITORY}.git"`,
    );
  });

  test('recovers orphan tags without moving them', () => {
    expect(workflowSource).toContain('reuse|recover)');
    expect(workflowSource).not.toContain('repair)');
    expect(workflowSource).not.toContain('--force-with-lease');
    expect(workflowSource).not.toContain('git tag -fa');
    expect(workflowSource).not.toContain('RELEASE_STATUS');

    expect(workflowSource).toContain('git tag -a "$TAG" "$RELEASE_TARGET_SHA"');
  });
});
