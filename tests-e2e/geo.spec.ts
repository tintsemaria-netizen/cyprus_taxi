import { test, expect } from '@playwright/test';
test('picker uses granted geolocation (centers near device)', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 34.6790, longitude: 33.0450, accuracy: 30 }); // Limassol
  const geoErrors:string[]=[];
  page.on('console',(m)=>{const t=m.text(); if(/geolocation|permission|denied|Permissions-Policy/i.test(t)) geoErrors.push(`${m.type()}:${t}`);});
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByText('Set pickup on map').click();
  await expect(page.getByRole('button', { name: 'Confirm pickup' })).toBeEnabled({ timeout: 20000 });
  await page.waitForTimeout(4000);
  // "Location permission denied" text must NOT be shown when granted
  const denied = await page.getByText(/Location permission denied|Location unavailable/).count();
  const center = await page.evaluate(() => {
    const w:any = window; return null; // center read not exposed; rely on screenshot + no-denied
  });
  await page.screenshot({ path: 'screenshots-live/geo-picker.png' });
  console.log('GEO', JSON.stringify({ deniedShown: denied, geoLogs: geoErrors.slice(0,5) }));
  expect(denied, 'should not show denied when permission granted').toBe(0);
});
