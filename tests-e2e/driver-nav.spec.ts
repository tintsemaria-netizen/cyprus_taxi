import { test, expect } from '@playwright/test';
// Driver full-screen navigation for an accepted ride (local prod build, fixture tests-e2e/seed-nav.ts).
// The navigation API is stubbed with a fixed route so the check doesn't depend on Google.
const OUT = 'screenshots/driver-nav';
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ['geolocation'], geolocation: { latitude: 34.6766, longitude: 33.0413 } });

// Car heads south 330 m, turns left (east) towards the pickup. [lat, lng]
const PATH: [number, number][] = [[34.6766, 33.0413], [34.6751, 33.0413], [34.6736, 33.0413], [34.6736, 33.0425], [34.6706, 33.0425], [34.6706, 33.0413]];
const ROUTE = {
  available: true, leg: 'pickup', distanceM: 900, durationSec: 180, path: PATH,
  steps: [
    { at: 0, maneuver: 'DEPART', text: 'Head south on Leof. Spyrou Araouzou', distanceM: 330 },
    { at: 2, maneuver: 'TURN_LEFT', text: 'Turn left onto Agiou Andreou', distanceM: 110 },
    { at: 3, maneuver: 'TURN_RIGHT', text: 'Turn right onto Marina Rd', distanceM: 330 },
  ],
};

test('accepted ride: full-screen navigation replaces tabs; stage actions and details work', async ({ page, context }) => {
  const r = await page.request.post('/api/v1/auth/login', { data: { login: 'andreas', password: 'qapass123' }, headers: { origin: 'http://localhost:3065' } });
  expect(r.ok()).toBeTruthy();
  const navCalls: { from: { lat: number; lng: number }; lang: string }[] = [];
  await page.route('**/api/v1/driver/navigation', async (route) => {
    navCalls.push(route.request().postDataJSON());
    await route.fulfill({ json: ROUTE });
  });
  await page.goto('/driver');
  const nav = page.getByTestId('driver-nav');
  await expect(nav).toBeVisible();
  // No tabs / bottom navigation / stats while driving.
  await expect(page.getByRole('button', { name: /^Trips/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Earnings/ })).toHaveCount(0);
  await expect(page.getByText('Last trips')).toHaveCount(0);

  // GPS off after a reload → one clear CTA; starting it builds the route.
  await nav.getByRole('button', { name: 'Start sharing' }).click();
  await expect(page.getByTestId('nav-instruction')).toHaveText('Head south on Leof. Spyrou Araouzou');
  expect(navCalls[0].from).toEqual({ lat: 34.6766, lng: 33.0413 });
  expect(navCalls[0].lang).toBe('en');
  await expect(page.getByTestId('nav-summary')).toContainText('3 min');
  await expect(nav.getByText('Limassol Marina')).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/start.png` });
  await expect(nav.getByText('Eleni K.').first()).toBeVisible();

  // Drive 150 m south: the next manoeuvre becomes the left turn with the remaining distance.
  await context.setGeolocation({ latitude: 34.6751, longitude: 33.0413 });
  await expect(page.getByTestId('nav-instruction')).toHaveText('Turn left onto Agiou Andreou', { timeout: 10000 });
  await expect(page.getByText(/^1[56]0 m$/)).toBeVisible();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/navigating.png` });

  // Details reveal the full card (note, release) without leaving navigation.
  await nav.getByRole('button', { name: 'Details' }).click();
  await expect(page.getByTestId('nav-details')).toContainText('Blue suitcase');
  await expect(page.getByTestId('nav-details').getByRole('button', { name: /release/ })).toBeVisible();
  await page.screenshot({ path: `${OUT}/details.png`, fullPage: true });
  await nav.getByRole('button', { name: 'Hide' }).click();

  // Stage action: "I'm on the way" → EN_ROUTE, next action is "I've arrived".
  await nav.getByRole('button', { name: "I'm on the way" }).click();
  await expect(nav.getByRole('button', { name: "I've arrived" })).toBeVisible();

  // Panning the map stops following; Re-centre brings it back.
  const map = page.getByRole('application', { name: 'Map' }).or(page.locator('.maplibregl-canvas')).first();
  const box = (await map.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 8 });
  await page.mouse.up();
  await expect(nav.getByRole('button', { name: 'Re-centre' })).toBeVisible();
  await nav.getByRole('button', { name: 'Re-centre' }).click();
  await expect(nav.getByRole('button', { name: 'Re-centre' })).toHaveCount(0);
});
