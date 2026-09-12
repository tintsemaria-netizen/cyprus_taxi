import { test, expect, Page } from '@playwright/test';

const SHOTS = 'screenshots';

async function openBooking(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Where to next?' })).toBeVisible();
}

// Drag the picker map by a fixed offset to move the draft coordinate.
async function panMap(page: Page, dx = 120, dy = 80) {
  const map = page.locator('[aria-label^="Map"]').first();
  const box = await map.boundingBox();
  if (!box) throw new Error('no map');
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - dx, cy - dy, { steps: 8 });
  await page.mouse.up();
}

test('layout: no horizontal overflow at 1440/390/360', async ({ page }) => {
  for (const w of [1440, 390, 360]) {
    await page.setViewportSize({ width: w, height: w < 500 ? 844 : 900 });
    await openBooking(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `viewport ${w}px`).toBeLessThanOrEqual(1);
  }
});

test('screenshots: desktop + mobile booking', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openBooking(page);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/desktop-booking.png` });

  await page.setViewportSize({ width: 390, height: 844 });
  await openBooking(page);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/mobile-booking.png` });
});

test('picker opens full-screen for BOTH fields; screenshots', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBooking(page);

  await page.getByText('Set pickup on map').click();
  await expect(page.getByRole('heading', { name: 'Set pickup location' })).toBeVisible();
  await expect(page.getByText('My location')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm pickup' })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/mobile-picker-pickup.png` });
  await page.getByRole('button', { name: 'Back' }).click();

  await page.getByText('Set destination on map').click();
  await expect(page.getByRole('heading', { name: 'Set destination' })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/mobile-picker-destination.png` });
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Where to next?' })).toBeVisible();
});

test('form state and other stop survive picker confirm', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 34.6800, longitude: 33.0450, accuracy: 40 });
  await page.setViewportSize({ width: 390, height: 844 });
  await openBooking(page);

  await page.getByPlaceholder('Your name').fill('QA Rider');
  await page.getByPlaceholder('+357 …').fill('+35799123456');

  // pick a destination via the picker, then confirm
  await page.getByText('Set destination on map').click();
  await expect(page.getByRole('heading', { name: 'Set destination' })).toBeVisible();
  await page.waitForTimeout(1000);
  await panMap(page);
  await page.getByRole('button', { name: 'Confirm destination' }).click();

  // name/phone preserved; destination now filled
  await expect(page.getByPlaceholder('Your name')).toHaveValue('QA Rider');
  await expect(page.getByPlaceholder('+357 …')).toHaveValue('+35799123456');
  const dest = await page.getByPlaceholder('Destination').inputValue();
  expect(dest.length, 'destination filled').toBeGreaterThan(0);
});

test('REGRESSION: a delayed (stale) reverse response is never applied as the confirmed label', async ({ page }) => {
  // Reverse geocode is slow AND returns a bogus label. Confirming before it resolves
  // must yield a COORDINATE label, never the stale address.
  await page.route('**/api/v1/places/reverse**', async (route) => {
    await new Promise((r) => setTimeout(r, 3000));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ demo: true, place: { label: 'STALE-LABEL-XYZ' } }) });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await openBooking(page);
  await page.getByText('Set pickup on map').click();
  await expect(page.getByRole('heading', { name: 'Set pickup location' })).toBeVisible();
  await page.waitForTimeout(800);
  await panMap(page);                 // move to a new point
  await page.getByRole('button', { name: 'Confirm pickup' }).click(); // confirm BEFORE the 3s response
  const pickup = await page.getByPlaceholder('Pickup location').inputValue();
  expect(pickup).toMatch(/^Pin /);    // coordinate fallback, not the stale label
  expect(pickup).not.toContain('STALE-LABEL-XYZ');
});

test('real map tiles actually LOAD (HTTP 200) from the configured provider', async ({ page }) => {
  let ok = 0, bad = 0;
  page.on('response', (res) => {
    try {
      const h = new URL(res.url()).host;
      if (h.includes('arcgisonline.com') || h.includes('tile.openstreetmap.org')) {
        if (res.status() === 200) ok++; else bad++;
      }
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await openBooking(page);
  await page.getByText('Set pickup on map').click();
  await page.waitForTimeout(4000);
  expect(ok, `tiles 200=${ok} non200=${bad}`).toBeGreaterThan(0);
  expect(bad, 'no blocked/failed tiles').toBe(0);
});
