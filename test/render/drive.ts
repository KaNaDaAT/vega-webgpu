import type { Page } from '@playwright/test';

/** A frame read back off the GPU, as `captureFrame` resolves it. */
export interface Capture {
  width: number;
  height: number;
  data: Uint8Array;
}

/** What the harnesses publish on `window`. */
export interface HarnessWindow {
  __renderDone?: boolean;
  __renderError?: string;
  /** Share of a frame drawn on, over white. See harness-common.js. */
  __ink(shot: Capture): number;
}

/**
 * The harness page for a spec or a scene fixture, drawn with `renderer`.
 * `extra` is the rest of the query, as `&name=value` pairs.
 */
export function harnessUrl(kind: 'spec' | 'scene', name: string, renderer = 'webgpu', extra = ''): string {
  const page = kind === 'spec' ? 'harness' : 'scene-harness';
  return `/test/render/${page}.html?${kind}=${encodeURIComponent(name)}&renderer=${renderer}${extra}`;
}

/**
 * Records a page's uncaught errors as they happen, and its console errors too
 * when asked, for a test to assert there were none. Each is cut to `limit`
 * characters, so a failure message stays readable.
 */
export function collectPageErrors(page: Page, { withConsole = false, limit = Infinity } = {}): string[] {
  const errors: string[] = [];
  const add = (text: string) => errors.push(text.slice(0, limit));
  page.on('pageerror', e => add(String(e)));
  if (withConsole) {
    page.on('console', m => {
      if (m.type() === 'error') {
        add(m.text());
      }
    });
  }
  return errors;
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
