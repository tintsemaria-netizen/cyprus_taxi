import { test, expect } from '@playwright/test';
// Read-only live check of the batch-2 booking form (no sign-in, no booking is created).
test('live booking form: per-class prices + sticky CTA', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('Pickup address').fill('Limassol Marina');
  await page.getByRole('listbox').getByRole('option').first().click({ timeout: 20000 });
  await page.getByLabel('Destination address').fill('Larnaca Airport');
  await page.getByRole('listbox').getByRole('option').first().click({ timeout: 20000 });
  await expect(page.getByRole('radio').first()).toContainText('€', { timeout: 20000 });
  await expect(page.getByRole('button', { name: /^Request .* · ≈ €/ })).toBeInViewport();
  await page.getByRole('radio').nth(1).scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots-live/batch2-booking-live-390.png' });
});
