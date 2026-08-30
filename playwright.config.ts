import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * WebGPU needs a real Chromium build with the new headless mode. The
 * default Playwright "headless shell" has no GPU support. The flags enable
 * WebGPU on top of SwiftShader (Chromium's bundled software Vulkan driver)
 * so rendering is deterministic on GPU-less CI runners.
 */

/**
 * Finds an installed Chromium-family browser. Playwright's bundled build does
 * not launch on every machine, so fall back to whatever is installed rather
 * than making each contributor hardcode a path. `CHROME_PATH` (also read by
 * Playwright and Puppeteer) or `PLAYWRIGHT_BROWSER_PATH` override the search.
 */
function findBrowser(): string | undefined {
  const override = process.env.PLAYWRIGHT_BROWSER_PATH || process.env.CHROME_PATH;
  if (override) {
    return override;
  }
  // CI installs its own chromium, so don't pick up a stray system browser.
  if (process.env.CI) {
    return undefined;
  }
  const win = ['Google\\Chrome', 'Microsoft\\Edge', 'BraveSoftware\\Brave-Browser', 'Chromium'];
  const exe = ['chrome.exe', 'msedge.exe', 'brave.exe', 'chrome.exe'];
  const candidates =
    process.platform === 'win32'
      ? [process.env.LOCALAPPDATA, process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']]
          .filter((r): r is string => !!r)
          .flatMap(root => win.map((dir, i) => join(root, dir, 'Application', exe[i])))
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
          ]
        : ['/usr/bin/google-chrome', '/usr/bin/microsoft-edge', '/usr/bin/brave-browser', '/usr/bin/chromium'];
  return candidates.find(existsSync);
}

const executablePath = findBrowser();

// A local, real browser must run SINGLE-WORKER. WebGPU itself is on
// SwiftShader in both branches, but --enable-features=Vulkan still brings up
// the machine's physical Vulkan driver per browser, and one browser per CPU
// core has crashed an AMD display driver (BSOD in amdkmdag.sys on RDNA4).
// Serializing to one browser at a time avoids that pile-up. (Disabling GPU
// compositing was tried as extra insurance but it blanks the WebGPU canvas in
// screenshots, so compositing stays on.) CI runs headless on SwiftShader with no
// hardware GPU, so it safely keeps full parallelism.
const localBrowser = !process.env.CI && !!executablePath;

export default defineConfig({
  testDir: './test/render',
  timeout: 60_000,
  fullyParallel: !localBrowser,
  workers: localBrowser ? 1 : undefined,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Always produce the HTML report (a browsable webgpu-vs-canvas gallery via
  // the per-test image attachments). `npm run test:report` opens it.
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:8123',
    viewport: { width: 1000, height: 800 },
    deviceScaleFactor: 1,
    ...(executablePath ? {} : { channel: 'chromium' as const }),
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: [
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan',
        '--disable-vulkan-surface',
        '--use-webgpu-adapter=swiftshader',
      ],
    },
  },
  webServer: {
    command: 'npx http-server -p 8123 -c-1 --silent',
    port: 8123,
    reuseExistingServer: !process.env.CI,
  },
});
