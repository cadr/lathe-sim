import { test, expect, openApp, clickTimes } from './fixtures';

test('free play: face and turn with the handwheel buttons', async ({ page }) => {
  await openApp(page);

  // 1.000" brass bar, 1.5" sticking out: the end is at Z 1.500
  await page.getByTestId('stock-preset-brass-1000').click();
  await page.getByTestId('stock-load').click();
  await page.getByTestId('tool-turning').click();
  await page.getByTestId('rpm-600').click();
  await page.getByTestId('spindle-fwd').click();
  await expect(page.getByTestId('dro-spindle')).toHaveText('FWD');
  await expect(page.getByTestId('dro-rpm')).toHaveText('600');

  await page.getByTestId('tab-section').click();
  const profile = page.getByTestId('section-profile');
  await expect(profile).toBeVisible();
  const before = await profile.getAttribute('d');

  // carriage from Z 2.000 to 1.490: 5 revs + 10 divisions counter-clockwise (toward the chuck)
  await clickTimes(page, 'hw-z-minusrev', 5);
  await clickTimes(page, 'hw-z-minus10', 1);
  await expect(page.getByTestId('dro-z')).toHaveText('1.490');

  // face: cross slide in from X dia 1.500 to just past center (15 revs + 10 divisions clockwise)
  await clickTimes(page, 'hw-x-plusrev', 15);
  await expect(page.getByTestId('dro-xdia')).toHaveText('0.000');
  await clickTimes(page, 'hw-x-plus10', 1);
  await expect(page.getByTestId('dro-xdia')).toHaveText('-0.020');
  await expect(page.getByTestId('dro-xrad')).toHaveText('-0.010');

  // back out to X dia 0.900 (radius 0.450): a 0.050 roughing pass
  await clickTimes(page, 'hw-x-minusrev', 9);
  await clickTimes(page, 'hw-x-minus10', 1);
  await expect(page.getByTestId('dro-xdia')).toHaveText('0.900');

  // turn: feed the carriage 0.5" toward the chuck
  await clickTimes(page, 'hw-z-minusrev', 5);
  await expect(page.getByTestId('dro-z')).toHaveText('0.990');
  await expect(page.getByTestId('section-dia')).toHaveText('Ø 0.900 at Z 0.990');
  await expect(profile).not.toHaveAttribute('d', before ?? '');
  const ev = await page.evaluate(() => window.__lathe!.getState().state.events.map((e) => e.kind));
  expect(ev).toContain('cut');
  expect(ev).not.toContain('heavyCut');
  expect(ev).not.toContain('poorFinish');
  await expect(page.getByTestId('toasts').locator('[data-testid^="toast-"]')).toHaveCount(0);

  // spindle off, then touch the work: rubbing
  await page.getByTestId('spindle-off').click();
  await expect(page.getByTestId('dro-spindle')).toHaveText('OFF');
  await clickTimes(page, 'hw-x-plus10', 1);
  await expect(page.getByTestId('toast-rubbing')).toBeVisible();
  await page.getByTestId('tab-log').click();
  await expect(page.getByTestId('event-log').locator('li[data-kind="rubbing"]')).toHaveCount(1);
});
