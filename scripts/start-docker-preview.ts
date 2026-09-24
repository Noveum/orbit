import { resolve } from 'node:path';
import { ensureDockerPreviewScheduler, initializeDockerPreview } from './init-docker-preview';

type CommandRunner = (command: string[], root: string) => Promise<void>;

async function runCommand(command: string[], root: string): Promise<void> {
  const child = Bun.spawn(command, {
    cwd: root,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const status = await child.exited;
  if (status !== 0) throw new Error(`${command.join(' ')} failed with exit code ${status}.`);
}

export async function startDockerPreview(
  root: string,
  run: CommandRunner = runCommand,
): Promise<void> {
  await run(['docker', 'compose', 'version'], root);
  await run(['docker', 'info', '--format', '{{.ServerVersion}}'], root);
  try {
    await initializeDockerPreview(root);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
  }
  await ensureDockerPreviewScheduler(root);
  for (const step of ['tools', 'infra', 'migrate', 'build', 'up', 'storage-check', 'status']) {
    await run([process.execPath, 'run', `preview:${step}`], root);
  }
}

if (import.meta.main) {
  await startDockerPreview(resolve(import.meta.dir, '..'));
  console.info('Orbit is ready at http://127.0.0.1:33170. Create an account to get started.');
}
