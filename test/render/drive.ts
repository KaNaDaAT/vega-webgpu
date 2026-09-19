import type { Page } from '@playwright/test';

/** What the harnesses publish on `window` once a render has settled. */
interface HarnessWindow {
  __renderDone?: boolean;
  __renderError?: string;
}

/**
 * Waits for a harness page to finish a render.
 *
 * The shape of the wait matters, which is why it is in one place: a render
 * that throws sets `__renderError` and never sets `__renderDone`, so waiting on
 * the done flag alone hangs until the test times out with nothing to say. Both
 * harnesses and every page driven spec settle the same way, and twenty of them
 * had written this out.
 */
export function waitForRender(page: Page, timeout = 60_000): Promise<unknown> {
  return page.waitForFunction(
    () => {
      const w = window as unknown as HarnessWindow;
      return w.__renderDone || w.__renderError;
    },
    undefined,
    { timeout },
  );
}
