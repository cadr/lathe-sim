import { test, expect, openApp, clickTimes, traverse, type Page } from './fixtures';

// Pin: 0.500 ±0.005 × 1.000 ±0.010 from 1.000" brass, 1.5" stick-out (face at Z 1.500).
// Long traverses go through the store (traverse); tool changes, spindle, the last few
// handwheel clicks and "Check my part" go through the UI.

async function startPin(page: Page) {
  await openApp(page);
  await page.getByTestId('challenge-start-pin').click();
  await expect(page.getByTestId('challenge-panel')).toBeVisible();
  await expect(page.getByTestId('mode-badge')).toHaveText('Challenge: Pin');
  await expect(page.getByTestId('part-drawing')).toBeVisible();
  await page.getByTestId('challenge-load-stock').click();
  await expect(page.getByTestId('challenge-load-stock')).toHaveText(/Reload/);
}

async function faceAndTurn(page: Page, finalRadius: number) {
  await page.getByTestId('tool-turning').click();
  await page.getByTestId('rpm-600').click();
  await page.getByTestId('spindle-fwd').click();

  for (const faceZ of [1.49, 1.48]) {
    await traverse(page, 'z', faceZ);
    await traverse(page, 'x', 0.02);
    await clickTimes(page, 'hw-x-plus10', 3); // finish the facing pass past center by hand
    await traverse(page, 'x', 0.75);
  }

  // roughing passes of 0.040 or less on the radius, then finish
  for (const r of [0.46, 0.42, 0.38, 0.34, 0.3, 0.275, 0.255, finalRadius]) {
    await traverse(page, 'z', 1.5);
    await traverse(page, 'x', r);
    await traverse(page, 'z', 0.35);
    await traverse(page, 'x', 0.75);
  }
  await traverse(page, 'z', 1.5);
}

async function partOff(page: Page) {
  await page.getByTestId('spindle-off').click();
  await page.getByTestId('tool-parting').click();
  await page.getByTestId('rpm-300').click();
  await page.getByTestId('spindle-fwd').click();
  // blade tip 1.0625 behind the face at Z 1.480
  await traverse(page, 'z', 0.418);
  await traverse(page, 'x', 0.03);
  await clickTimes(page, 'hw-x-plus10', 4); // the last 0.040 by hand: the pin drops off
  await expect(page.getByTestId('toast-parted')).toBeVisible();
  await traverse(page, 'x', 0.75);
  await page.getByTestId('spindle-off').click();
}

test('pin challenge: a good part passes', async ({ page }) => {
  await startPin(page);
  await faceAndTurn(page, 0.25);
  await partOff(page);
  await page.getByTestId('challenge-check').click();
  const banner = page.getByTestId('grade-banner');
  await expect(banner).toHaveAttribute('data-passed', 'true');
  await expect(banner).toContainText('Pass');
  await expect(page.getByTestId('grade-check').filter({ hasText: 'Safety' })).toHaveAttribute('data-ok', 'true');
  await expect(page.getByTestId('toast-crash')).toHaveCount(0);
});

test('pin challenge: an undersize part fails with an explanation', async ({ page }) => {
  await startPin(page);
  await faceAndTurn(page, 0.24); // Ø0.480: 0.020 under
  await partOff(page);
  await page.getByTestId('challenge-check').click();
  await expect(page.getByTestId('grade-banner')).toHaveAttribute('data-passed', 'false');
  await expect(page.getByTestId('grade-banner')).toContainText('Not yet');
  await expect(page.getByTestId('mistake-list')).toContainText(/undersize/i);
});

test('crash: parting blade into the chuck jaws', async ({ page }) => {
  await startPin(page);
  await page.getByTestId('tool-parting').click();
  await page.getByTestId('rpm-300').click();
  await page.getByTestId('spindle-fwd').click();
  // outside the 1.000" stock, run up close to the jaws, then one click too far
  await traverse(page, 'z', 0.07);
  await expect(page.getByTestId('dro-crash')).toHaveCount(0);
  await page.getByTestId('hw-z-minus10').click();
  await expect(page.getByTestId('toast-crash')).toBeVisible();
  await expect(page.getByTestId('dro-crash')).toHaveText('CRASH');

  await page.getByTestId('challenge-check').click();
  await expect(page.getByTestId('grade-banner')).toHaveAttribute('data-passed', 'false');
  await expect(page.getByTestId('mistake-list')).toContainText(/crash into/i);
});

test('show solution: confirm, pause, speed up, then take over', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('challenge-start-faced-slug').click();
  await page.getByTestId('challenge-solution').click();
  // a styled inline confirmation, not a browser dialog
  await expect(page.getByTestId('challenge-confirm')).toBeVisible();
  await page.getByTestId('challenge-confirm-yes').click();

  const playback = page.getByTestId('solution-playback');
  await expect(playback).toBeVisible();
  await expect(page.getByTestId('solution-position')).toHaveText(/^Step 1 of \d+/);
  await expect(page.getByTestId('solution-step-title')).not.toBeEmpty();
  await expect(page.getByTestId('controls-locked')).toContainText('Playing the solution');
  await expect(page.getByTestId('spindle-fwd')).toBeDisabled();

  // pause: the controls unlock; play: they lock again
  await page.getByTestId('solution-play').click();
  await expect(page.getByTestId('solution-play')).toHaveText(/Play/);
  await expect(page.getByTestId('controls-locked')).toHaveCount(0);
  await expect(page.getByTestId('spindle-fwd')).toBeEnabled();
  await page.getByTestId('speed-8').click();
  await page.getByTestId('solution-play').click();
  await expect(page.getByTestId('controls-locked')).toBeVisible();
  await expect(page.getByTestId('solution-position')).toHaveText(/^Step [2-9]/, { timeout: 15_000 });

  // take over from the banner: the solution stops for good and the controls are ours
  await page.getByTestId('controls-take-over').click();
  await expect(playback).toHaveCount(0);
  await expect(page.getByTestId('controls-locked')).toHaveCount(0);
  await expect(page.getByTestId('spindle-off')).toBeEnabled();
  const player = await page.evaluate(() => window.__lathe!.getState().player);
  expect(player).toBeNull();
});
