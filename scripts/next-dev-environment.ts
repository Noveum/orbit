import { realpath, stat } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

export async function nodeRuntimePath(pathValue: string, bunExecutable: string): Promise<string> {
  const executable = await realpath(bunExecutable);
  const identity = await stat(executable);
  const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
  const entries = await Promise.all(
    pathValue.split(delimiter).map(async (directory) => {
      try {
        const node = await realpath(join(directory, nodeName));
        const candidate = await stat(node);
        return node === executable ||
          (identity.ino !== 0 && candidate.dev === identity.dev && candidate.ino === identity.ino)
          ? null
          : directory;
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          (error.code === 'ENOENT' || error.code === 'ENOTDIR')
        ) {
          return directory;
        }
        throw error;
      }
    }),
  );
  return entries.filter((entry) => entry !== null).join(delimiter);
}
