import { test, expect } from '@playwright/test';

// Guards against Content-Security-Policy violations while the Google map loads.
// NOTE: the headless harness uses software-WebGL (raster fallback), so it does not
// exercise the vector shared-label worker that triggered the reported connect-src
// block; the definitive proof for that is the live response-header check below plus
// the CSP header assertion. This test still catches script/img/connect/style/worker
// violations that occur during load and any regressions.
test('no Maps CSP violations while the map loads', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    const t = m.text();
    if (/Content Security Policy|Refused to (connect|load|execute|apply)|violates the following/i.test(t)) violations.push(t);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Where to next?' })).toBeVisible();
  await page.getByText('Set pickup on map').click();
  await expect(page.getByRole('button', { name: 'Confirm pickup' })).toBeEnabled({ timeout: 20000 });
  await page.waitForTimeout(3000);
  expect(violations, `CSP violations: ${violations.slice(0, 5).join(' | ')}`).toHaveLength(0);
});

// Asserts the live CSP header itself permits the Google vector-map worker resources.
test('CSP header allows Google Maps worker sources (connect-src *.gstatic.com + data:)', async ({ page }) => {
  const resp = await page.request.get('/');
  const csp = resp.headers()['content-security-policy'] || '';
  const connect = (csp.split(';').find((d) => d.trim().startsWith('connect-src')) || '');
  expect(connect, 'connect-src must include *.gstatic.com').toMatch(/\*\.gstatic\.com/);
  expect(connect, 'connect-src must include data:').toMatch(/(^|\s)data:/);
  expect(connect, 'connect-src must include *.google.com').toMatch(/\*\.google\.com/);
});
