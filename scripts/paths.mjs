/**
 * Where the scripts and the render suite find the repository and what a run
 * leaves behind, so none of them works its own way back from its file.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root. */
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Where a render suite run with RENDER_ARTIFACTS=1 leaves its pngs and manifest. */
export const outputDir = join(root, 'test', 'render', 'output');

/** The manifest of that run, which the gallery reads. */
export const manifestPath = join(outputDir, 'index.json');

/** The manifest the last run wrote, or null when there is none. */
export function readManifest() {
  return existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
}
