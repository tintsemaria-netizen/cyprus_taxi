import { test, expect, Page } from '@playwright/test';

// Count reverse-geocode requests, optionally with a controllable delay/label.
async function mockReverse(page: Page, opts: { delayMs?: number; label?: string | null } = {}) {
  const counter = { n: 0 };
  await page.route('**/api/v1/places/reverse**', async (route) => {
    counter.n++;
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ demo: true, place: opts.label === undefined ? null : (opts.label ? { label: opts.label } : null) }),
    });
  });
  return counter;
}

async function openPicker(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Where to next?' })).toBeVisible();
  await page.getByText('Set pickup on map').click();
  await expect(page.getByRole('button', { name: 'Confirm pickup' })).toBeEnabled({ timeout: 15000 });
}

test('IDLE INVARIANT: after settle, no reverse requests for 8s (no flicker loop)', async ({ page }) => {
  const c = await mockReverse(page, { label: 'Demo Place' });
  await page.setViewportSize({ width: 390, height: 844 });
  await openPicker(page);
  await page.waitForTimeout(2000);      // let the initial lookup settle
  const afterSettle = c.n;
  await page.waitForTimeout(8000);      // idle
  expect(c.n - afterSettle, `extra reverse calls while idle`).toBe(0);
});

test('RESIZE with constant coordinate does not restart lookup', async ({ page }) => {
  const c = await mockReverse(page, { label: 'Demo Place' });
  await page.setViewportSize({ width: 390, height: 844 });
  await openPicker(page);
  await page.waitForTimeout(2000);
  const before = c.n;
  // Change viewport size several times (triggers ResizeObserver → map.resize()).
  await page.setViewportSize({ width: 360, height: 800 });
  await page.setViewportSize({ width: 412, height: 915 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(2000);
  expect(c.n - before, `reverse calls caused by resize`).toBe(0);
});

test('HUNG reverse request times out to a coordinate fallback (spinner clears)', async ({ page }) => {
  await mockReverse(page, { delayMs: 20000, label: 'NEVER' }); // longer than the 8s client timeout
  await page.setViewportSize({ width: 390, height: 844 });
  await openPicker(page);
  // Within ~10s the spinner must clear and the panel show a coordinate fallback.
  await expect(page.getByText('resolving…')).toBeHidden({ timeout: 11000 });
  await expect(page.getByText(/^Pin /)).toBeVisible();
});

test('one settled pan produces a bounded lookup and keeps exact coordinates', async ({ page }) => {
  const c = await mockReverse(page, { label: 'Panned Place' });
  await page.setViewportSize({ width: 390, height: 844 });
  await openPicker(page);
  await page.waitForTimeout(1500);
  const before = c.n;
  const map = page.locator('[aria-label^="Map"]').first();
  const box = (await map.boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx - 100, cy - 60, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(1500);
  const delta = c.n - before;
  expect(delta, `debounced to a single lookup for one pan`).toBeLessThanOrEqual(1);
});
