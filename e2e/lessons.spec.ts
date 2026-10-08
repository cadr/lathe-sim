import { test, expect, openApp, clickTimes } from './fixtures';

test('watch the facing lesson to the end at 8x', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('lesson-watch-facing').click();
  await expect(page.getByTestId('mode-badge')).toHaveText('Lesson: Facing · Watch');
  await expect(page.getByTestId('lesson-panel')).toBeVisible();
  await page.getByTestId('speed-8').click();
  await expect(page.getByTestId('speed-8')).toHaveAttribute('aria-pressed', 'true');
  // controls are locked while the demo plays
  await expect(page.getByTestId('controls-locked')).toBeVisible();
  await expect(page.getByTestId('spindle-fwd')).toBeDisabled();

  await expect(page.getByTestId('lesson-complete')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('lesson-position')).toHaveText(/All \d+ steps done/);
  await expect(page.getByTestId('toast-crash')).toHaveCount(0);
  await expect(page.getByTestId('toast-rubbing')).toHaveCount(0);
  await expect(page.getByTestId('controls-locked')).toHaveCount(0);
  const state = await page.evaluate(() => {
    const s = window.__lathe!.getState().state;
    return { crashed: s.damage.crashed, events: s.events.map((e) => e.kind) };
  });
  expect(state.crashed).toBe(false);
  expect(state.events).not.toContain('crash');
  expect(state.events).not.toContain('toolBroken');
});

test('do the machine tour yourself', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('lesson-diy-tour').click();
  await expect(page.getByTestId('lesson-panel')).toHaveAttribute('data-diy', 'true');
  await expect(page.getByTestId('lesson-position')).toHaveText(/^Step 1 of \d+/);
  // controls stay live in do-it-yourself mode
  await expect(page.getByTestId('controls-locked')).toHaveCount(0);

  // step 1 (spindle off) already holds on arrival: it says so and moves on by itself
  await expect(page.getByTestId('diy-check')).toContainText('Already done');
  await expect(page.getByTestId('lesson-position')).toHaveText(/^Step 2 of/, { timeout: 5_000 });

  // step 2: mount the turning tool
  await page.getByTestId('tool-turning').click();
  await expect(page.getByTestId('diy-check')).toHaveAttribute('data-ok', 'true');
  await expect(page.getByTestId('lesson-position')).toHaveText(/^Step 3 of/);
  await expect(page.getByTestId('lesson-step-1')).toHaveAttribute('data-done', 'true');

  // step 3: cross slide in five turns, X dia 1.500 -> 1.000
  await clickTimes(page, 'hw-x-plusrev', 5);
  await expect(page.getByTestId('dro-xdia')).toHaveText('1.000');
  await expect(page.getByTestId('lesson-position')).toHaveText(/^Step 4 of/);

  // step 4: zero the dial, then wind out two turns
  await page.getByTestId('hw-x-zero').click();
  await expect(page.getByTestId('dro-dial-x')).toContainText('00');
  await clickTimes(page, 'hw-x-minusrev', 2);
  await expect(page.getByTestId('dro-xdia')).toHaveText('1.200');
  await expect(page.getByTestId('lesson-position')).toHaveText(/^Step 5 of/);
});

test('do it yourself: Show me locks the controls, plays the step and hands back', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('lesson-diy-facing').click();
  await expect(page.getByTestId('lesson-position')).toHaveText(/^Step 1 of/);
  // the instruction is at the top of the panel, in view without scrolling
  await expect(page.getByTestId('diy-instruction')).toBeInViewport();
  await page.getByTestId('speed-2').click();
  await page.getByTestId('diy-show-me').click();
  await expect(page.getByTestId('controls-locked')).toBeVisible();
  await expect(page.getByTestId('controls-locked')).toContainText('Showing you this step');
  await expect(page.getByTestId('stock-load')).toBeDisabled();
  await expect(page.getByTestId('diy-next')).toBeDisabled();
  // the step (load the stock) plays, the lock lifts and the lesson moves on
  await expect(page.getByTestId('controls-locked')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId('lesson-position')).toHaveText(/^Step 2 of/, { timeout: 5_000 });
  await expect(page.getByTestId('stock-load')).toBeEnabled();
  const loaded = await page.evaluate(() => window.__lathe!.getState().state.workpiece !== null);
  expect(loaded).toBe(true);

  // a demo can be stopped from the banner
  await page.getByTestId('diy-show-me').click();
  await expect(page.getByTestId('controls-locked')).toBeVisible();
  await page.getByTestId('controls-take-over').click();
  await expect(page.getByTestId('controls-locked')).toHaveCount(0);
});

for (const size of [
  { width: 1100, height: 800 },
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
]) {
  test(`do it yourself at ${size.width}x${size.height}: "Waiting until" is visible without scrolling`, async ({ page }) => {
    await page.setViewportSize(size);
    await openApp(page);
    // scroll the home list down first, as a user reaching the card would
    await page.getByTestId('lesson-diy-turning').scrollIntoViewIfNeeded();
    await page.getByTestId('lesson-diy-turning').click();
    await expect(page.getByTestId('diy-check')).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('diy-check')).toContainText('Waiting until');
  });
}
