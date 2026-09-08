import { expect, it } from 'bun:test';

for (const script of ['backfill', 'verify']) {
  for (const args of [[], ['--all', '--organization=example'], ['--organization=']]) {
    it(`${script} refuses unsafe organization scope ${JSON.stringify(args)}`, async () => {
      const child = Bun.spawn(['bun', `scripts/notification-conversation-${script}.ts`, ...args], {
        cwd: `${import.meta.dir}/..`,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      expect(code).not.toBe(0);
      expect(error).toMatch(/Choose --all|cannot be empty/);
    });
  }
}
