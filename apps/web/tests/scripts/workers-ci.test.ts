import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import {
  assertBuiltFor,
  buildEnvironment,
  deployArguments,
  deployEnvironment,
  previewAlias,
  type SourceConfig,
  workersTarget,
} from '../../scripts/workers-ci.ts';

const config: SourceConfig = {
  env: {
    production: { name: 'orbit', vars: { NODE_ENV: 'production' } },
    preview: {
      name: 'orbit-pr',
      vars: {
        NODE_ENV: 'production',
        BETTER_AUTH_URL: 'https://orbit-pr.acme.workers.dev',
        NEXT_PUBLIC_APP_URL: 'https://orbit-pr.acme.workers.dev',
        ORBIT_AUTH_ALLOWED_HOSTS: '*-orbit-pr.acme.workers.dev',
        ORBIT_PASSWORD_AUTH: 'true',
      },
    },
  },
};

describe('previewAlias', () => {
  it('keeps a branch name that is already a DNS label', () => {
    expect(previewAlias('fix-login', 'orbit-pr')).toBe('fix-login');
  });

  it('marks a rewritten branch name with a digest so two branches never share an alias', () => {
    const slashed = previewAlias('fix/login', 'orbit-pr');
    expect(slashed).toMatch(/^fix-login-[0-9a-f]{6}$/);
    expect(slashed).not.toBe(previewAlias('fix-login', 'orbit-pr'));
    expect(previewAlias('Fix-Login', 'orbit-pr')).not.toBe(slashed);
    expect(previewAlias('feat/Deploy_Noveum--Workers', 'orbit-pr')).toMatch(
      /^feat-deploy-noveum-workers-[0-9a-f]{6}$/,
    );
  });

  it('starts every alias with a letter', () => {
    expect(previewAlias('123-fix', 'orbit-pr')).toMatch(/^b-123-fix-[0-9a-f]{6}$/);
    expect(previewAlias('/', 'orbit-pr')).toMatch(/^b-[0-9a-f]{6}$/);
  });

  it('keeps long aliases inside one DNS label and distinct per branch', () => {
    const first = previewAlias(`feat/${'a'.repeat(80)}-one`, 'orbit-pr');
    const second = previewAlias(`feat/${'a'.repeat(80)}-two`, 'orbit-pr');
    expect(`${first}-orbit-pr`.length).toBeLessThanOrEqual(63);
    expect(first).toMatch(/^[a-z][a-z0-9-]*[a-z0-9]$/);
    expect(first).not.toBe(second);
    expect(previewAlias(`feat/${'a'.repeat(80)}-one`, 'orbit-pr')).toBe(first);
  });
});

describe('workersTarget', () => {
  it('deploys main to production', () => {
    expect(workersTarget({ WORKERS_CI_BRANCH: 'main' }, config)).toEqual({
      environment: 'production',
      worker: 'orbit',
    });
  });

  it('sends every other branch to its own preview', () => {
    expect(workersTarget({ WORKERS_CI_BRANCH: 'fix-login' }, config)).toEqual({
      environment: 'preview',
      worker: 'orbit-pr',
      base: false,
      alias: 'fix-login',
      url: 'https://fix-login-orbit-pr.acme.workers.dev',
    });
  });

  it('updates the preview Worker itself when the preview connection builds main', () => {
    expect(workersTarget({ WORKERS_CI_BRANCH: 'main', CLOUDFLARE_ENV: 'preview' }, config)).toEqual(
      { environment: 'preview', worker: 'orbit-pr', base: true },
    );
  });

  it('refuses to send a branch other than main to production', () => {
    expect(() =>
      workersTarget({ WORKERS_CI_BRANCH: 'fix-login', CLOUDFLARE_ENV: 'production' }, config),
    ).toThrow('Only main deploys to production');
  });

  it('refuses to run outside Workers Builds or with an unknown environment', () => {
    expect(() => workersTarget({}, config)).toThrow('WORKERS_CI_BRANCH is not set');
    expect(() =>
      workersTarget({ WORKERS_CI_BRANCH: 'main', CLOUDFLARE_ENV: 'staging' }, config),
    ).toThrow('Unknown CLOUDFLARE_ENV staging');
  });

  it('refuses a preview base URL that is not the preview Worker address', () => {
    const misnamed: SourceConfig = {
      env: {
        ...config.env,
        preview: { ...config.env.preview, vars: { BETTER_AUTH_URL: 'https://orbit.noveum.ai' } },
      },
    };
    expect(() => workersTarget({ WORKERS_CI_BRANCH: 'fix-login' }, misnamed)).toThrow(
      'must be the workers.dev address of orbit-pr',
    );
  });
});

describe('buildEnvironment', () => {
  it('builds production without requiring a database', () => {
    expect(buildEnvironment({ environment: 'production', worker: 'orbit' }, config)).toEqual({
      CLOUDFLARE_ENV: 'production',
    });
  });

  it('compiles the preview address into a branch build', () => {
    const environment = buildEnvironment(
      workersTarget({ WORKERS_CI_BRANCH: 'fix-login' }, config),
      config,
    );
    expect(environment).toMatchObject({
      CLOUDFLARE_ENV: 'preview',
      BETTER_AUTH_URL: 'https://fix-login-orbit-pr.acme.workers.dev',
      NEXT_PUBLIC_APP_URL: 'https://fix-login-orbit-pr.acme.workers.dev',
      ORBIT_PASSWORD_AUTH: 'true',
    });
    expect(environment).not.toHaveProperty('NODE_ENV');
  });
});

describe('deployArguments', () => {
  it('deploys production and the preview Worker itself', () => {
    expect(deployArguments({ environment: 'production', worker: 'orbit' })).toEqual([
      'deploy',
      '--config',
      'dist/server/wrangler.json',
    ]);
    expect(deployArguments({ environment: 'preview', worker: 'orbit-pr', base: true })).toEqual([
      'deploy',
      '--config',
      'dist/server/wrangler.json',
    ]);
  });

  it('creates a named Worker Preview with its own address for a branch', () => {
    expect(deployArguments(workersTarget({ WORKERS_CI_BRANCH: 'fix-login' }, config))).toEqual([
      'preview',
      '--config',
      'dist/server/wrangler.json',
      '--name',
      'fix-login',
      '--var',
      'BETTER_AUTH_URL:https://fix-login-orbit-pr.acme.workers.dev',
      '--var',
      'NEXT_PUBLIC_APP_URL:https://fix-login-orbit-pr.acme.workers.dev',
    ]);
  });
});

describe('deployEnvironment', () => {
  it('hides CLOUDFLARE_ENV from wrangler, which would rename the flattened Worker', () => {
    expect(
      deployEnvironment({
        CLOUDFLARE_ENV: 'production',
        WORKERS_CI_BRANCH: 'main',
        WRANGLER_CI_OVERRIDE_NAME: 'orbit',
        UNSET: undefined,
      }),
    ).toEqual({ WORKERS_CI_BRANCH: 'main', WRANGLER_CI_OVERRIDE_NAME: 'orbit' });
  });
});

describe('assertBuiltFor', () => {
  const production = { environment: 'production', worker: 'orbit' } as const;

  it('accepts a bundle built for the target on its own connection', () => {
    expect(() =>
      assertBuiltFor(production, 'orbit', { WRANGLER_CI_OVERRIDE_NAME: 'orbit' }),
    ).not.toThrow();
  });

  it('refuses a bundle built for another Worker', () => {
    expect(() => assertBuiltFor(production, 'orbit-pr', {})).toThrow(
      'The bundle was built for orbit-pr, not orbit.',
    );
  });

  it('refuses to deploy production from the preview connection', () => {
    expect(() =>
      assertBuiltFor(production, 'orbit', {
        WRANGLER_CI_OVERRIDE_NAME: 'orbit-pr',
        WORKERS_CI_BRANCH: 'main',
      }),
    ).toThrow('This build is connected to orbit-pr, but main targets orbit.');
  });
});

describe('the checked-in Workers configuration', () => {
  it('gives each environment its own Worker and database', async () => {
    const source = JSON.parse(
      await readFile(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'),
    ) as {
      readonly env: Record<
        string,
        {
          readonly name: string;
          readonly hyperdrive: readonly { readonly id: string }[];
          readonly triggers: { readonly crons: readonly string[] };
          readonly services?: readonly { readonly service: string }[];
        }
      >;
    };
    const production = source.env['production'];
    const preview = source.env['preview'];
    expect(production?.name).toBe('orbit');
    expect(preview?.name).toBe('orbit-pr');
    expect(preview?.hyperdrive[0]?.id).not.toBe(production?.hyperdrive[0]?.id);
    expect(preview?.triggers.crons).toEqual([]);
    expect(preview?.services ?? []).toEqual([]);
    expect(production?.services?.map((service) => service.service)).toEqual(['orbit']);
  });
});
