import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { BASE } from './base-url.ts';

const LONG_DESCRIPTION = Array.from(
  { length: 14 },
  (_, index) =>
    `Paragraph ${index + 1}: the shared packages diverged, so the audit had to walk Cost Explorer, EKS, RDS, EC2 and CloudWatch by hand before anything else could be trusted.`,
).join('\n');

async function signIn(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByTestId(`dev-sign-in-${email}`).click();
  await page.waitForURL(`${BASE}/my-issues`);
  return page;
}

async function composeLongIssue(page: Page): Promise<void> {
  await page.goto(`${BASE}/team/eng/board`);
  await expect(page.getByTestId('board-column-Todo')).toBeVisible();
  await page.keyboard.press('c');
  await expect(page.getByTestId('quick-create')).toBeVisible();
  await page.getByTestId('quick-create-title').fill('Audit the AWS bill');
  await page.getByTestId('quick-create-description').click();
  await page.keyboard.insertText(LONG_DESCRIPTION);
}

test('a long description scrolls instead of covering the property row', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const author = await signIn(context, 'alex@orbit.example');

  await composeLongIssue(author);

  const laidOut = await author.evaluate(() => {
    const description = document.querySelector('[data-testid="quick-create-description"]');
    const properties = document.querySelector('[data-testid="quick-create-properties"]');
    const scroller = document.querySelector('[data-testid="quick-create-scroll"]');
    if (description === null || properties === null || scroller === null) {
      throw new Error('the composer never rendered');
    }
    const prose = description.querySelector('.ProseMirror');
    if (prose === null) throw new Error('the description never rendered');
    return {
      descriptionHeight: description.getBoundingClientRect().height,
      proseHeight: prose.getBoundingClientRect().height,
      descriptionBottom: description.getBoundingClientRect().bottom,
      propertiesTop: properties.getBoundingClientRect().top,
      scrolls: scroller.scrollHeight - scroller.clientHeight,
    };
  });

  expect(laidOut.descriptionHeight).toBeGreaterThanOrEqual(laidOut.proseHeight);
  expect(laidOut.propertiesTop).toBeGreaterThanOrEqual(laidOut.descriptionBottom);
  expect(laidOut.scrolls).toBeGreaterThan(0);

  await context.close();
});

test('the estimate picker still opens once the description is long', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const author = await signIn(context, 'alex@orbit.example');

  await composeLongIssue(author);

  const estimate = author.getByTestId('quick-create-estimate');
  await estimate.scrollIntoViewIfNeeded();
  await estimate.click();
  await author.getByRole('menuitemradio', { name: '3 points', exact: true }).click();
  await expect(estimate).toHaveText(/3 points/);

  await context.close();
});
