import { test, expect } from '@playwright/test';
// Admin reliability page on a local prod build (data from tests/reliability.db.test.ts).
test('admin reliability: flagged driver first, detail events, definitions', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const r = await page.request.post('/api/v1/auth/login', { data: { login: 'admin', password: 'qapass123' }, headers: { origin: 'http://localhost:3065' } });
  expect(r.ok()).toBeTruthy();
  await page.goto('/admin/reliability');
  await expect(page.getByRole('heading', { name: 'Driver reliability' })).toBeVisible();
  await expect(page.getByText('Late pre-book releases').first()).toBeVisible();
  await page.getByRole('button', { name: /Andreas/ }).click();
  await expect(page.getByText('Rude and late')).toBeVisible();
  await page.screenshot({ path: 'screenshots/reliability/admin-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'screenshots/reliability/admin-mobile.png', fullPage: true });
});
