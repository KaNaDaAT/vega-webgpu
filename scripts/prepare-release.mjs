/**
 * Prepares the GitHub-Pages-hosted release folder for a version:
 *   node scripts/prepare-release.mjs 2.0.0 [--notes "release notes html"]
 *
 * - copies the build output to releases/<x_y_z>/
 * - records the notes in releases/releases.json
 * - regenerates releases/versions.js and releases/index.html
 *
 * Run by .github/workflows/release.yml; safe to run locally as well.
 * The build must exist (npm run build) before invoking this script.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releasesDir = join(root, 'releases');
const releasesJsonPath = join(releasesDir, 'releases.json');

const args = process.argv.slice(2);
const version = (args[0] ?? '').replace(/^v/, '');
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error(`Usage: node scripts/prepare-release.mjs <version> [--notes "..."]\nGot version: '${version}'`);
  process.exit(1);
}
const notesIndex = args.indexOf('--notes');
const notes = notesIndex !== -1 ? (args[notesIndex + 1] ?? '') : '';

const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
if (packageVersion !== version) {
  console.error(`Version mismatch: package.json has ${packageVersion}, release is ${version}.`);
  process.exit(1);
}

// 1. copy build artifacts
const folder = join(releasesDir, version.replaceAll('.', '_'));
mkdirSync(folder, { recursive: true });
const artifacts = [
  'vega-webgpu-renderer.js',
  'vega-webgpu-renderer.js.map',
  'vega-webgpu-renderer.min.js',
  'vega-webgpu-renderer.min.js.map',
  'vega-webgpu-renderer.module.js',
  'vega-webgpu-renderer.module.js.map',
];
for (const file of artifacts) {
  const source = join(root, 'build', file);
  if (!existsSync(source)) {
    console.error(`Missing build artifact: ${source}. Run 'npm run build' first.`);
    process.exit(1);
  }
  copyFileSync(source, join(folder, file));
}

// 2. record release notes
const releases = JSON.parse(readFileSync(releasesJsonPath, 'utf8'));
releases[version] = notes || releases[version] || '';
writeFileSync(releasesJsonPath, `${JSON.stringify(releases, null, 2)}\n`);

// 3. regenerate versions.js (newest first)
const escapeHtml = s =>
  String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Number() on a prerelease segment like 'rc1' is NaN, which compares equal and
// leaves 2.0.0-rc1 and 2.0.0-rc2 in arbitrary order. Compare those as strings.
const byVersionDesc = (a, b) => {
  const pa = a.split(/[-.]/);
  const pb = b.split(/[-.]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    // A missing segment means no prerelease suffix, which outranks one that
    // has it: 2.0.0 is newer than 2.0.0-rc1.
    if (pa[i] === undefined) return -1;
    if (pb[i] === undefined) return 1;
    const na = Number(pa[i]);
    const nb = Number(pb[i]);
    if (Number.isNaN(na) || Number.isNaN(nb)) {
      // numeric: true keeps rc10 above rc2
      const d = pb[i].localeCompare(pa[i], undefined, { numeric: true });
      if (d) return d;
      continue;
    }
    const d = nb - na;
    if (d) return d;
  }
  return 0;
};

const versions = Object.keys(releases).sort(byVersionDesc);
writeFileSync(
  join(releasesDir, 'versions.js'),
  `const vegaWebGPURendererVersions = [${versions.map(v => `'${v}'`).join(', ')}];\n`,
);

// 4. regenerate index.html
const rows = versions
  .map(v => {
    const href = `./${v.replaceAll('.', '_')}/vega-webgpu-renderer.js`;
    return `        <tr>\n          <td><a href="${href}">${v}</a></td>\n          <td>${escapeHtml(releases[v])}</td>\n        </tr>`;
  })
  .join('\n');

writeFileSync(
  join(releasesDir, 'index.html'),
  `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="./index.css" />
    <title>vega-webgpu-renderer Releases</title>
  </head>
  <body>
    <table>
      <thead>
        <tr>
          <th>Version</th>
          <th>Changes</th>
        </tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </body>
</html>
`,
);

console.log(`Prepared release ${version} in ${folder}`);
