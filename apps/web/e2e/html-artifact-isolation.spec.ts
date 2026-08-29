import { expect, test } from '@playwright/test';
import { BASE } from './base-url.ts';

test('a sandboxed html artifact cannot drive a mutation as the viewer', async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByTestId('dev-sign-in-alex@orbit.example').click();
  await page.waitForURL(`${BASE}/my-issues`);

  const victim = await page.evaluate(async (base) => {
    const made = await fetch(`${base}/api/docs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Archived target', content: '# target', kind: 'markdown' }),
    }).then((response) => response.json());
    await fetch(`${base}/api/docs/${made.doc.id}`, { method: 'DELETE' });
    const after = await fetch(`${base}/api/docs/${made.doc.id}`).then((r) => r.json());
    return { id: made.doc.id as string, archived: after.doc.archivedAt !== null };
  }, BASE);

  expect(victim.archived).toBe(true);

  const token = await page.evaluate(
    async ({ base, id }) => {
      const html = `<!doctype html><html><body><form id="f" method="POST" action="${base}/api/docs/${id}/restore"></form><script>document.getElementById('f').submit();</script></body></html>`;
      const made = await fetch(`${base}/api/docs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Hostile artifact', content: html, kind: 'html' }),
      }).then((response) => response.json());
      const shared = await fetch(`${base}/api/docs/${made.doc.id}/share`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ visibility: 'public' }),
      }).then((response) => response.json());
      return shared.doc.publishToken as string;
    },
    { base: BASE, id: victim.id },
  );

  const attempts: number[] = [];
  page.on('response', (response) => {
    if (response.url().endsWith(`/api/docs/${victim.id}/restore`)) attempts.push(response.status());
  });

  await page.goto(`${BASE}/h/${token}`);
  await expect.poll(() => attempts.length, { timeout: 30_000 }).toBeGreaterThan(0);

  expect(attempts.every((status) => status === 401 || status === 403)).toBe(true);

  const still = await page.evaluate(
    async ({ base, id }) =>
      await fetch(`${base}/api/docs/${id}`).then((response) => response.json()),
    { base: BASE, id: victim.id },
  );
  expect(still.doc.archivedAt).not.toBeNull();

  await context.close();
});
