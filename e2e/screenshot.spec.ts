import { test, expect, openApp, clickTimes, traverse } from './fixtures';

test('screenshots: docs/screenshots/app.png and closeup.png', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, { no3d: false });
  await expect(page.locator('[data-testid="lathe-canvas"] canvas')).toBeVisible();

  await page.getByTestId('stock-load').click();
  await page.getByTestId('tool-turning').click();
  await page.getByTestId('spindle-fwd').click();
  // face, then turn a 0.750 shoulder 1" long
  await traverse(page, 'z', 1.49);
  await traverse(page, 'x', -0.01);
  await traverse(page, 'x', 0.75);
  for (const r of [0.46, 0.42, 0.385, 0.375]) {
    await traverse(page, 'z', 1.55);
    await traverse(page, 'x', r);
    await traverse(page, 'z', 0.49);
    await traverse(page, 'x', 0.75);
  }
  // park the tool beside the finished diameter, using the handwheel for the last bit
  await traverse(page, 'z', 1.3);
  await traverse(page, 'x', 0.4);
  await clickTimes(page, 'hw-z-minusrev', 2);
  await page.getByTestId('tab-section').click();
  await expect(page.getByTestId('section-profile')).toBeVisible();

  // no toasts or slow-renderer note in the pictures
  for (const close of await page.getByTestId('toasts').getByRole('button', { name: 'Dismiss' }).all()) await close.click();
  const slow = page.getByTestId('slow-3d-dismiss');
  if (await slow.isVisible()) await slow.click();

  // the camera glides between presets; give it time to settle before each shot
  await page.getByTestId('cam-overview').click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'docs/screenshots/app.png', fullPage: true });

  await page.getByTestId('cam-chuck').click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'docs/screenshots/closeup.png', fullPage: true });
});
