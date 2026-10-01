import { test, expect, Page } from '@playwright/test';

// Batch-2 UX check (2026-10-01 audit) against a local production build on an isolated _test DB.
// Tokens come from tests-e2e/seed-batch2.ts. Screenshots → tests-e2e/screenshots/batch2/.
const TRACK = process.env.QA_TRACK_TOKEN || '';
const SHARE = process.env.QA_SHARE_TOKEN || '';
const OUT = 'screenshots/batch2';
const SIZES = [{ name: '390', width: 390, height: 844 }, { name: '320', width: 320, height: 640 }];

async function shot(page: Page, name: string) { await page.waitForTimeout(800); await page.screenshot({ path: `${OUT}/${name}.png` }); }

for (const s of SIZES) {
  test.describe(`mobile ${s.name}`, () => {
    test.use({ viewport: { width: s.width, height: s.height }, isMobile: true, hasTouch: true });

    test('tracking: pinned driver + code, ETA headline, rating, scrollable sheet, safety + cancel sheets', async ({ page }) => {
      await page.goto(`/track#token=${TRACK}`);
      const headline = page.getByRole('status').first();
      await expect(headline).toContainText('Meet Andreas');
      await expect(page.getByLabel(/Number plate/)).toBeVisible();
      await expect(page.getByLabel(/^Start code/)).toBeVisible();
      await expect(page.getByLabel(/Rated 4.7 out of 5/)).toBeVisible();
      await shot(page, `track-${s.name}`);
      // The lower part of the sheet scrolls; the cancel button is reachable.
      const cancelBtn = page.getByRole('button', { name: 'Cancel booking' });
      await cancelBtn.scrollIntoViewIfNeeded();
      await expect(cancelBtn).toBeInViewport();
      await expect(page.getByLabel(/Number plate/)).toBeInViewport(); // still pinned
      await shot(page, `track-scrolled-${s.name}`);
      await page.getByRole('button', { name: /Safety/ }).click();
      await expect(page.getByRole('dialog', { name: 'Safety' })).toBeVisible();
      await expect(page.getByRole('link', { name: /112/ })).toHaveAttribute('href', 'tel:112');
      await shot(page, `track-safety-${s.name}`);
      await page.keyboard.press('Escape').catch(() => {});
      await page.getByRole('button', { name: 'Close' }).click();
      await cancelBtn.click();
      await expect(page.getByRole('alertdialog', { name: 'Cancel this ride?' })).toBeVisible();
      await shot(page, `track-cancel-${s.name}`);
      await page.getByRole('button', { name: 'Keep it' }).click();
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
    });

    test('share page: view only, no start code, no phone, no cancel', async ({ page }) => {
      await page.goto(`/share#t=${SHARE}`);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.getByText('KXY 248')).toBeVisible();
      await expect(page.getByRole('button', { name: /Cancel/ })).toHaveCount(0);
      await expect(page.getByText(/Start code|Give this code/)).toHaveCount(0);
      await expect(page.locator('a[href^="tel:+"]')).toHaveCount(0);
      await shot(page, `share-${s.name}`);
    });

    test('booking form: sticky request button visible without scrolling', async ({ page }) => {
      await page.goto('/');
      const cta = page.getByRole('button', { name: /^Request/ });
      await expect(cta).toBeInViewport();
      await expect(page.getByRole('radiogroup', { name: 'Choose your ride' })).toBeVisible();
      await expect(page.getByLabel('Pickup address')).toBeVisible();
      await shot(page, `booking-${s.name}`);
    });
  });
}

test('booking form with both stops: per-class prices + CTA with price', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('Pickup address').fill('Limassol Marina');
  await page.getByRole('listbox').getByRole('option').first().click({ timeout: 15000 });
  await page.getByLabel('Destination address').fill('Larnaca Airport');
  await page.getByRole('listbox').getByRole('option').first().click({ timeout: 15000 });
  const radios = page.getByRole('radio');
  await expect(radios.first()).toContainText('€', { timeout: 15000 });
  await expect(radios.nth(1)).toContainText('€');
  await expect(page.getByRole('button', { name: /^Request .* · ≈ €/ })).toBeInViewport();
  await expect(page.getByText(/official fixed airport fares/)).toBeVisible();
  await shot(page, 'booking-priced-390');
  await radios.nth(1).scrollIntoViewIfNeeded();
  await shot(page, 'booking-classes-390');
});

test('staff security: 2FA setup shows a QR and a manual key', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/staff/login');
  await page.getByLabel('Login').fill('admin');
  await page.getByLabel('Password').fill('qapass123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dispatch');
  await page.goto('/staff/security');
  await page.getByRole('button', { name: 'Set up two-factor' }).click();
  await expect(page.getByLabel('QR code for your authenticator app').locator('svg')).toBeVisible();
  await expect(page.getByLabel('Manual setup key')).toBeVisible();
  await shot(page, 'staff-security-390');
});
