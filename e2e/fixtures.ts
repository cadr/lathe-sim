// Shared Playwright fixtures and helpers.
// Every test gets a page that records console errors and uncaught exceptions; the test fails if
// any show up (DESIGN.md section 14: no console errors in the browser).
import { test as base, expect, type Page } from '@playwright/test';

/**
 * Console errors we knowingly ignore. Keep this list empty unless there is no way to fix the
 * cause, and say why next to each entry.
 */
export const IGNORED_CONSOLE_ERRORS: readonly RegExp[] = [];

export interface ConsoleLog {
  errors: string[];
  warnings: string[];
}

export const test = base.extend<{ consoleLog: ConsoleLog }>({
  consoleLog: [
    async ({ page }, use, testInfo) => {
      const log: ConsoleLog = { errors: [], warnings: [] };
      page.on('console', (msg) => {
        const text = msg.text();
        if (msg.type() === 'error' && !IGNORED_CONSOLE_ERRORS.some((re) => re.test(text))) log.errors.push(text);
        if (msg.type() === 'warning') log.warnings.push(text);
      });
      page.on('pageerror', (err) => log.errors.push(`pageerror: ${err.message}`));
      await use(log);
      if (log.warnings.length) {
        await testInfo.attach('console-warnings', { body: log.warnings.join('\n'), contentType: 'text/plain' });
        if (process.env.E2E_PRINT_WARNINGS) console.log(`[${testInfo.title}] warnings:\n  ${log.warnings.join('\n  ')}`);
      }
      expect(log.errors, 'console errors / page errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
export type { Page } from '@playwright/test';

/** Open the app. `no3d` skips the 3D view (faster, deterministic); the dev store handle is always on. */
export async function openApp(page: Page, { no3d = true }: { no3d?: boolean } = {}): Promise<void> {
  await page.goto(`/?e2e=1${no3d ? '&no3d=1' : ''}`);
  await expect(page.getByTestId('control-panel')).toBeVisible();
  await page.waitForFunction(() => !!window.__lathe);
}

/** Click a test id `times` times (e.g. handwheel step buttons). */
export async function clickTimes(page: Page, testId: string, times: number): Promise<void> {
  const el = page.getByTestId(testId);
  for (let i = 0; i < times; i++) await el.click();
}

type Axis = 'x' | 'z' | 'quill';

/**
 * Long traverse through the store (window.__lathe), standing in for many handwheel clicks.
 * Moves the axis to `target` in whole divisions, reporting a dt that keeps the feed at `feed`
 * in/s. The default, 0.015 in/s, is under every per-revolution finish limit at 300 rpm and up
 * (parting allows 0.004"/rev = 0.02 in/s at 300 rpm). Only the reported dt changes: the move
 * itself is instant.
 */
export async function traverse(page: Page, axis: Axis, target: number, feed = 0.015): Promise<void> {
  await page.evaluate(
    ({ axis, target, feed }) => {
      const store = window.__lathe!;
      const s = store.getState().state;
      const pos = axis === 'x' ? s.x : axis === 'z' ? s.z : s.quill;
      // pitch per rev / divisions per rev; cross slide clockwise is -x, the others +
      const [pitch, divs, sign] = axis === 'x' ? [0.05, 50, -1] : [0.1, 100, 1];
      const delta = target - pos;
      const revs = Math.round(((sign * delta) / pitch) * divs) / divs;
      if (revs === 0) return;
      store.getState().turn(axis, revs, Math.max(0.05, Math.abs(delta) / feed));
    },
    { axis, target, feed },
  );
}

/** Current machine state, read through the dev handle. */
export async function machine(page: Page) {
  return page.evaluate(() => {
    const s = window.__lathe!.getState().state;
    return {
      x: s.x,
      z: s.z,
      quill: s.quill,
      events: s.events.map((e) => e.kind),
      parted: s.partedPieces.length,
    };
  });
}
