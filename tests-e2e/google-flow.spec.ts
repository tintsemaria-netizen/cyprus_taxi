import { test, expect } from '@playwright/test';
test('LIVE: Google address search -> select stops -> route + estimate render', async ({ page }) => {
  let routeReq = 0;
  page.on('response', (r) => { if (r.url().includes('/api/v1/routes/estimate')) routeReq++; });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Where to next?' })).toBeVisible();
  // From
  await page.getByPlaceholder('Pickup location').fill('Limassol Marina');
  await expect(page.locator('button', { hasText: 'Marina' }).first()).toBeVisible({ timeout: 10000 });
  await page.locator('button', { hasText: 'Marina' }).first().click();
  // To
  await page.getByPlaceholder('Destination').fill('Larnaca Airport');
  await expect(page.locator('button', { hasText: 'Larnaka' }).first()).toBeVisible({ timeout: 10000 });
  await page.locator('button', { hasText: 'Larnaka' }).first().click();
  // Route estimate line appears
  await expect(page.getByText(/Estimated trip:/)).toBeVisible({ timeout: 12000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots-live/google-booking-route.png' });
  expect(routeReq, 'routes/estimate called').toBeGreaterThan(0);
});
