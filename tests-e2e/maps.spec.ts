import { test, expect, Page } from '@playwright/test';
// Map rendering guard (QA env has no Google key → MapLibre fallback). Catches the Turbopack/MapLibre 6
// worker failure that once left the dispatch map drawn outside its card ("Worker failed to load").
const BOOKING = process.env.QA_BOOKING_ID || '';
const TRACK = process.env.QA_TRACK_TOKEN || '';

function watch(page: Page) {
  const errs: string[] = [];
  page.on('console', (m) => { if (/worker|map error/i.test(m.text()) && (m.type() === 'error' || m.type() === 'warning')) errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(e.message));
  return errs;
}
async function mapRendered(page: Page) {
  const canvas = page.locator('.maplibregl-canvas').first();
  await expect(canvas).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2500); // let tiles + worker messages settle
}

test('booking home map renders without worker errors', async ({ page }) => {
  const errs = watch(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await mapRendered(page);
  expect(errs).toEqual([]);
});

test('tracking map renders without worker errors', async ({ page }) => {
  const errs = watch(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/track#token=${TRACK}`);
  await mapRendered(page);
  expect(errs).toEqual([]);
});

test('dispatch booking map renders inside its card', async ({ page }) => {
  const errs = watch(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  const r = await page.request.post('/api/v1/auth/login', { data: { login: 'dispatcher', password: 'qapass123' }, headers: { origin: 'http://localhost:3065' } });
  expect(r.ok()).toBeTruthy();
  await page.goto(`/dispatch/bookings/${BOOKING}`);
  await mapRendered(page);
  await expect(page.getByText('Map unavailable')).toHaveCount(0);
  await page.screenshot({ path: 'screenshots/staff/dispatch-map-fixed.png' });
  expect(errs).toEqual([]);
});
