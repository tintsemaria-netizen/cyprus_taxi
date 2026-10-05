import { test, expect } from '@playwright/test';
// Pre-booking UX on a local prod build (_test DB, fixture tests-e2e/seed-preassign.ts).
const TRACK = process.env.QA_TRACK_TOKEN || '';
const OUT = 'screenshots/preassign';
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('driver: pre-book board shows own commitment and an available airport ride; taking it works', async ({ page }) => {
  const r = await page.request.post('/api/v1/auth/login', { data: { login: 'maria', password: 'qapass123' }, headers: { origin: 'http://localhost:3065' } });
  expect(r.ok()).toBeTruthy();
  await page.goto('/driver');
  await page.getByRole('button', { name: /^Trips/ }).last().click();
  await page.getByRole('tab', { name: /Pre-book/ }).click();
  await expect(page.getByText('Your pre-booked rides')).toBeVisible();
  await expect(page.getByText('Flight W6 4321').first()).toBeVisible();
  await expect(page.getByText('Flight A3 612').first()).toBeVisible();
  await expect(page.getByText('Nikos')).toHaveCount(0); // no passenger identity before assignment
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/driver-board.png`, fullPage: true });
  await page.getByRole('button', { name: 'Take this ride' }).first().click();
  await expect(page.getByRole('status')).toContainText('Ride pre-booked');
  await page.screenshot({ path: `${OUT}/driver-board-taken.png`, fullPage: true });
});

test('passenger: scheduled ride shows the confirmed driver and flight', async ({ page }) => {
  await page.goto(`/track#token=${TRACK}`);
  await expect(page.getByText('Driver confirmed')).toBeVisible();
  await expect(page.getByText('Maria', { exact: true })).toBeVisible();
  await expect(page.getByText(/Flight: W6 4321/)).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/passenger-confirmed.png` });
});

test('booking: flight field appears only for a scheduled airport pickup', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Pickup address').fill('Larnaca Airport');
  await page.getByRole('listbox').getByRole('option').first().click({ timeout: 15000 });
  await expect(page.locator('#bk-flight')).toHaveCount(0); // "Now"
  await page.getByRole('button', { name: 'Schedule', exact: true }).click();
  await expect(page.locator('#bk-flight')).toBeVisible();
  await page.locator('#bk-flight').fill('a3 612');
  await page.locator('#bk-flight').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/booking-flight.png` });
});
