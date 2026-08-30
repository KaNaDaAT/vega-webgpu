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

export default defineConfig({
  testDir: './test/render',
  timeout: 60_000,
  // Single worker everywhere. Two browsers sharing one SwiftShader stack on a
  // CI runner fail every spec with an invalid-instance error.
  fullyParallel: false,
  workers: 1,
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
