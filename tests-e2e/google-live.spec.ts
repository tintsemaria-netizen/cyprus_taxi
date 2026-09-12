import { test, expect } from '@playwright/test';
test('LIVE: Google Maps renders in the picker (no auth error)', async ({ page }) => {
  const gmErrors: string[] = [];
  let gmapReq = 0, gmapOk = 0;
  page.on('console', (m) => { const t = m.text(); if (/Google Maps JavaScript API (error|warning)/i.test(t) && /error/i.test(t)) gmErrors.push(t); });
  page.on('response', (r) => { try { if (new URL(r.url()).host.endsWith('googleapis.com')) { gmapReq++; if (r.status() === 200) gmapOk++; } } catch {} });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Where to next?' })).toBeVisible();
  await page.getByText('Set pickup on map').click();
  await expect(page.getByRole('button', { name: 'Confirm pickup' })).toBeEnabled({ timeout: 20000 });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: 'screenshots-live/google-picker.png' });
  console.log('GMAP', JSON.stringify({ gmapReq, gmapOk, gmErrors: gmErrors.slice(0, 3) }));
  expect(gmErrors, `google auth/errors: ${gmErrors.join(' | ')}`).toHaveLength(0);
  expect(gmapReq, 'google maps requests made').toBeGreaterThan(0);
});
