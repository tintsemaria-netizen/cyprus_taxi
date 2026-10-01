import { test, expect } from '@playwright/test';

// Batch-3 i18n check on a local production build (_test DB, fixture tests-e2e/seed-batch2.ts).
const TRACK = process.env.QA_TRACK_TOKEN || '';
const SHARE = process.env.QA_SHARE_TOKEN || '';
const OUT = 'screenshots/i18n';

const CASES = [
  { locale: 'el-GR', lang: 'el', book: /Κράτηση|Ζητήστε|Comfort/, meet: /Andreas/ },
  { locale: 'ru-RU', lang: 'ru', book: /Заказ|Comfort/, meet: /Andreas/ },
];

for (const c of CASES) {
  test.describe(c.lang, () => {
    test.use({ locale: c.locale, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test('booking form follows the browser language, with prices', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('lang', c.lang);
      await page.locator('input[role="combobox"]').first().fill('Limassol Marina');
      await page.getByRole('listbox').getByRole('option').first().click({ timeout: 15000 });
      await page.locator('input[role="combobox"]').nth(1).fill('Larnaca Airport');
      await page.getByRole('listbox').getByRole('option').first().click({ timeout: 15000 });
      await expect(page.getByRole('radio').first()).toContainText('€', { timeout: 15000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${OUT}/booking-${c.lang}.png` });
      await page.getByRole('radio').nth(1).scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/booking-classes-${c.lang}.png` });
    });

    test('tracking + share', async ({ page }) => {
      await page.goto(`/track#token=${TRACK}`);
      await expect(page.getByRole('status').first()).toContainText(c.meet);
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${OUT}/track-${c.lang}.png` });
      await page.goto(`/share#t=${SHARE}`);
      await expect(page.getByText('KXY 248')).toBeVisible();
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${OUT}/share-${c.lang}.png` });
    });

    test('driver app', async ({ page }) => {
      const r = await page.request.post('/api/v1/auth/login', { data: { login: 'maria', password: 'qapass123' }, headers: { origin: 'http://localhost:3065' } });
      expect(r.ok()).toBeTruthy();
      await page.goto('/driver');
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `${OUT}/driver-${c.lang}.png` });
    });
  });
}

test('manual language switch overrides the browser language', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByRole('combobox', { name: 'Language' }).selectOption('ru');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru', { timeout: 10000 });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
});
