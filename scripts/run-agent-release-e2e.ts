import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export type AgentReleasePhase = 'writer-on' | 'writer-off';

export function createAgentReleaseEnvironment(
  inherited: Record<string, string>,
  phase: AgentReleasePhase,
  tokenFile: string,
  resultsDirectory: string,
): Record<string, string> {
  return {
    ...inherited,
    ORBIT_AGENT_IDENTITY_READ: 'true',
    ORBIT_AGENT_CONSENT: 'true',
    ORBIT_AGENT_ISSUE_WRITE: phase === 'writer-on' ? 'true' : 'false',
    ORBIT_ISSUE_OUTBOX_DISPATCH: 'true',
    ORBIT_E2E_SKIP_SEED: phase === 'writer-on' ? 'false' : 'true',
    ORBIT_MCP_VALIDATION_TOKEN_FILE: tokenFile,
    ORBIT_E2E_PRIVATE_RESULTS_DIR: resultsDirectory,
  };
}

export async function runAgentReleasePhases(
  execute: (phase: AgentReleasePhase) => number | Promise<number>,
  cleanup: () => void | Promise<void>,
): Promise<number> {
  try {
    const writerOnExitCode = await execute('writer-on');
    if (writerOnExitCode !== 0) return writerOnExitCode;
    return await execute('writer-off');
  } finally {
    await cleanup();
  }
}

function processEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

function assertReleaseEnvironment(environment: Record<string, string>): void {
  if ((environment['ORBIT_TEST_LANE'] ?? '').trim().length === 0) {
    throw new Error('Set a unique ORBIT_TEST_LANE before running Agent HTTP release checks.');
  }
  if ((environment['TEST_DATABASE_URL'] ?? '').trim().length > 0) {
    throw new Error('Unset TEST_DATABASE_URL so the release checks use their isolated lane.');
  }
  const baseUrl = new URL(environment['ORBIT_E2E_BASE_URL'] ?? 'http://127.0.0.1:23000');
  if (
    baseUrl.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '::1', '[::1]'].includes(baseUrl.hostname) ||
    baseUrl.pathname !== '/' ||
    baseUrl.search.length > 0 ||
    baseUrl.hash.length > 0 ||
    baseUrl.username.length > 0 ||
    baseUrl.password.length > 0
  ) {
    throw new Error('Agent HTTP release checks require a plain HTTP loopback origin.');
  }
  const realtimePort = Number(environment['ORBIT_E2E_REALTIME_PORT'] ?? '23101');
  if (!Number.isInteger(realtimePort) || realtimePort < 1 || realtimePort > 65535) {
    throw new Error('ORBIT_E2E_REALTIME_PORT must be an available port from 1 to 65535.');
  }
  environment['ORBIT_E2E_BASE_URL'] = baseUrl.toString().replace(/\/$/, '');
  environment['ORBIT_E2E_REALTIME_PORT'] = String(realtimePort);
  environment['ORBIT_DEV_LOGIN'] = '1';
}

function pathIsInside(directory: string, candidate: string): boolean {
  const relativePath = relative(directory, candidate);
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
  );
}

async function run(): Promise<number> {
  const inherited = processEnvironment();
  assertReleaseEnvironment(inherited);
  const repoRoot = resolve(import.meta.dirname, '..');
  const webDirectory = join(repoRoot, 'apps', 'web');
  let privateDirectory: string | null = null;
  let activeProcess: Bun.Subprocess | null = null;
  let interruptSignal: 'SIGINT' | 'SIGTERM' | null = null;

  const interrupt = (signal: 'SIGINT' | 'SIGTERM'): void => {
    interruptSignal ??= signal;
    activeProcess?.kill(signal);
  };
  const onInterrupt = (): void => interrupt('SIGINT');
  const onTerminate = (): void => interrupt('SIGTERM');
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);

  const cleanup = async (): Promise<void> => {
    const child = activeProcess;
    if (child !== null) {
      child.kill(interruptSignal ?? 'SIGTERM');
      await child.exited;
      activeProcess = null;
    }
    const directory = privateDirectory;
    if (directory !== null) {
      await rm(directory, { recursive: true, force: true });
      privateDirectory = null;
    }
  };

  const execute = async (phase: AgentReleasePhase): Promise<number> => {
    if (interruptSignal !== null) return interruptSignal === 'SIGINT' ? 130 : 143;
    if (privateDirectory === null) throw new Error('The private release directory is missing.');
    const tokenFile = join(privateDirectory, 'mcp-validation-token.json');
    const privateOutputDirectory = join(privateDirectory, 'playwright-results');
    const spec =
      phase === 'writer-on' ? 'e2e/mcp-http-release.spec.ts' : 'e2e/mcp-http-writer-off.spec.ts';
    const phaseOutputDirectory = join(privateOutputDirectory, phase);
    await mkdir(phaseOutputDirectory, { recursive: true, mode: 0o700 });
    if (interruptSignal !== null) return interruptSignal === 'SIGINT' ? 130 : 143;
    const environment = createAgentReleaseEnvironment(
      inherited,
      phase,
      tokenFile,
      phaseOutputDirectory,
    );
    const child = Bun.spawn(
      [
        process.execPath,
        '--env-file=../../.env',
        '--bun',
        'playwright',
        'test',
        '--config',
        'playwright.release.config.ts',
        spec,
      ],
      {
        cwd: webDirectory,
        env: environment,
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
      },
    );
    activeProcess = child;
    const exitCode = await child.exited;
    activeProcess = null;
    if (interruptSignal === 'SIGINT') return 130;
    if (interruptSignal === 'SIGTERM') return 143;
    return exitCode;
  };

  try {
    const [realRepoRoot, realTemporaryRoot] = await Promise.all([
      realpath(repoRoot),
      realpath(tmpdir()),
    ]);
    if (pathIsInside(realRepoRoot, realTemporaryRoot)) {
      throw new Error('The operating system temporary directory must be outside the checkout.');
    }
    privateDirectory = await mkdtemp(join(realTemporaryRoot, 'orbit-agent-release-'));
    return await runAgentReleasePhases(execute, cleanup);
  } finally {
    try {
      await cleanup();
    } finally {
      process.off('SIGINT', onInterrupt);
      process.off('SIGTERM', onTerminate);
    }
  }
}

if (import.meta.main) {
  run().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exitCode = 1;
    },
  );
}
