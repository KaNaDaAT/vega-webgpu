/**
 * Regenerates test/specs-valid.json, the list the demo page fills its spec
 * picker from. The page cannot read a directory, so the manifest stands in for
 * one and is generated rather than kept by hand.
 *
 * test/specs-ignore.json, if it exists, holds names to leave out.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test');
const manifest = join(testDir, 'specs-valid.json');
const ignoreFile = join(testDir, 'specs-ignore.json');

/** Every spec on disk the demo page should offer, sorted. */
export function specNames() {
  const ignored = new Set(existsSync(ignoreFile) ? JSON.parse(readFileSync(ignoreFile, 'utf8')) : []);
  return readdirSync(join(testDir, 'specs-valid'))
    .filter(f => f.endsWith('.vg.json'))
    .map(f => f.replace(/\.vg\.json$/, ''))
    .filter(name => !ignored.has(name))
    .sort();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const names = specNames();
  const next = JSON.stringify(names, null, 2) + '\n';
  const current = existsSync(manifest) ? readFileSync(manifest, 'utf8') : '';
  if (next === current) {
    console.log(`test/specs-valid.json already lists all ${names.length} specs`);
  } else {
    writeFileSync(manifest, next);
    console.log(`test/specs-valid.json rewritten with ${names.length} specs`);
  }
}
