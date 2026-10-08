import { test, expect, openApp, traverse } from './fixtures';

test.describe('app shell', () => {
  test('loads with header, tabs and control panel', async ({ page }) => {
    await openApp(page);
    await expect(page).toHaveTitle('Lathe Sim');
    await expect(page.getByRole('banner').getByRole('img', { name: 'Lathe Sim' })).toBeVisible();
    await expect(page.getByTestId('mode-badge')).toHaveText('Free play');
    for (const id of ['cam-overview', 'cam-tool', 'cam-chuck', 'cam-tailstock', 'app-home', 'app-help', 'app-settings']) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
    for (const id of ['tab-project', 'tab-section', 'tab-log']) await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.getByTestId('project-home')).toBeVisible();
    await expect(page.getByTestId('control-panel')).toBeVisible();
    await expect(page.getByTestId('dro-xdia')).toHaveText('1.500');
    await expect(page.getByTestId('dro-z')).toHaveText('2.000');

    await page.getByTestId('tab-section').click();
    await expect(page.getByTestId('section-view')).toBeVisible();
    await page.getByTestId('tab-log').click();
    await expect(page.getByTestId('event-log')).toBeVisible();
  });

  test('help popover explains the controls', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('app-help').click();
    const help = page.getByTestId('app-help-panel');
    await expect(help).toBeVisible();
    await expect(help).toContainText('clockwise moves the tool in toward the center');
    await expect(help).toContainText('Shop safety rules');
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();
  });

  test('favicon is served', async ({ page, request }) => {
    await openApp(page);
    const href = await page.locator('link[rel="icon"]').getAttribute('href');
    expect(href).toBeTruthy();
    const res = await request.get(href!);
    expect(res.ok()).toBe(true);
    expect(res.headers()['content-type']).toContain('svg');
  });

  test('narrow window stacks the control panel under the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await openApp(page);
    const view = await page.getByTestId('scene-fallback').boundingBox();
    const panel = await page.getByTestId('control-panel').boundingBox();
    expect(view && panel).toBeTruthy();
    expect(panel!.y).toBeGreaterThan(view!.y + view!.height - 1);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(900);
  });
});

for (const size of [
  { width: 1100, height: 800 },
  { width: 1440, height: 900 },
]) {
  test(`stock fields fit the control panel at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await openApp(page);
    const panel = page.getByTestId('control-panel');
    const overflow = await panel.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await panel.boundingBox();
    for (const id of ['stock-material', 'stock-diameter', 'stock-length', 'stock-stickOut']) {
      const field = await page.getByTestId(id).boundingBox();
      expect(field, id).toBeTruthy();
      expect(field!.x + field!.width, id).toBeLessThanOrEqual(box!.x + box!.width + 0.5);
    }
  });
}

test.describe('3D view', () => {
  test('renders a WebGL canvas by default', async ({ page }) => {
    await openApp(page, { no3d: false });
    const wrapper = page.getByTestId('lathe-canvas');
    await expect(wrapper).toBeVisible();
    await expect(wrapper.locator('canvas')).toBeVisible();
    await expect(page.getByTestId('scene-fallback')).toHaveCount(0);
    // the scene's frame loop drives the simulation
    const t0 = await page.evaluate(() => window.__lathe!.getState().clock);
    await expect.poll(() => page.evaluate(() => window.__lathe!.getState().clock)).toBeGreaterThan(t0 + 0.2);
    await page.getByTestId('cam-chuck').click();
    await expect(page.getByTestId('cam-chuck')).toHaveAttribute('aria-pressed', 'true');
  });

  test('cutting with the 3D view on runs without errors', async ({ page }) => {
    await openApp(page, { no3d: false });
    await expect(page.locator('[data-testid="lathe-canvas"] canvas')).toBeVisible();
    await page.getByTestId('stock-load').click();
    await page.getByTestId('tool-turning').click();
    await page.getByTestId('spindle-fwd').click();
    await page.getByTestId('cam-tool').click();
    // a facing pass and a turning pass in steps, with pauses so a few seconds of frames render
    await traverse(page, 'z', 1.49);
    for (const x of [0.6, 0.45, 0.3, 0.15, 0]) {
      await traverse(page, 'x', x);
      await page.waitForTimeout(300);
    }
    await traverse(page, 'x', 0.75);
    await traverse(page, 'z', 1.55);
    await traverse(page, 'x', 0.47);
    for (const z of [1.3, 1.1, 0.9]) {
      await traverse(page, 'z', z);
      await page.waitForTimeout(300);
    }
    await expect.poll(() => page.evaluate(() => window.__lathe!.getState().state.workpiece!.outer.some((r) => r < 0.48))).toBe(true);
    // the scene survived: no fallback (the console guard also fails on "3D view unavailable")
    await expect(page.getByTestId('scene-fallback')).toHaveCount(0);
    await expect(page.locator('[data-testid="lathe-canvas"] canvas')).toBeVisible();
  });

  test('?no3d=1 shows the fallback and the app still runs', async ({ page }) => {
    await openApp(page, { no3d: true });
    await expect(page.getByTestId('scene-fallback')).toBeVisible();
    await expect(page.getByTestId('scene-fallback')).toContainText('3D view is off');
    await expect(page.getByTestId('lathe-canvas')).toHaveCount(0);
    // the fallback ticker keeps the clock running
    const t0 = await page.evaluate(() => window.__lathe!.getState().clock);
    await expect.poll(() => page.evaluate(() => window.__lathe!.getState().clock)).toBeGreaterThan(t0 + 0.2);
    await page.getByTestId('app-settings').click();
    await expect(page.getByTestId('setting-no3d')).toBeChecked();
    await expect(page.getByTestId('setting-no3d')).toBeDisabled();
  });

  test('the settings toggle turns 3D off and remembers it', async ({ page }) => {
    await openApp(page, { no3d: false });
    await expect(page.locator('[data-testid="lathe-canvas"] canvas')).toBeVisible();
    await page.getByTestId('app-settings').click();
    await page.getByTestId('setting-no3d').check();
    await expect(page.getByTestId('scene-fallback')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('scene-fallback')).toBeVisible();
    await page.getByTestId('app-settings').click();
    await page.getByTestId('setting-no3d').uncheck();
    await expect(page.locator('[data-testid="lathe-canvas"] canvas')).toBeVisible();
  });
});
