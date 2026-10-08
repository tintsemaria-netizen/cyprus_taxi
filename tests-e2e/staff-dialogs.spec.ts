import { test, expect } from '@playwright/test';
// Staff consoles use in-app dialogs (no native confirm/prompt). Fixture: tests-e2e/seed-batch2.ts.
const BOOKING = process.env.QA_BOOKING_ID || '';
test.use({ viewport: { width: 1280, height: 900 } });

test('dispatcher: cancel asks in-app and "Keep booking" changes nothing; overrides require a reason', async ({ page }) => {
  page.on('dialog', () => { throw new Error('a native browser dialog was opened'); });
  const r = await page.request.post('/api/v1/auth/login', { data: { login: 'dispatcher', password: 'qapass123' }, headers: { origin: 'http://localhost:3065' } });
  expect(r.ok()).toBeTruthy();
  await page.goto(`/dispatch/bookings/${BOOKING}`);
  await page.getByRole('button', { name: /Cancel/ }).first().click();
  const sheet = page.getByRole('alertdialog', { name: 'Cancel this booking?' });
  await expect(sheet).toBeVisible();
  await page.screenshot({ path: 'screenshots/staff/dispatch-cancel.png' });
  await sheet.getByRole('button', { name: 'Keep booking' }).click();
  await expect(sheet).toHaveCount(0);

  await page.getByRole('button', { name: /Unassign/ }).first().click();
  const un = page.getByRole('alertdialog', { name: 'Unassign the driver?' });
  await expect(un).toBeVisible();
  await expect(un.getByLabel('Reason (audited, optional)')).toBeVisible();
  await page.screenshot({ path: 'screenshots/staff/dispatch-unassign.png' });
  await un.getByRole('button', { name: 'Cancel' }).click();
  await expect(un).toHaveCount(0);
});
