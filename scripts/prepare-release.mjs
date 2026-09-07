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
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releasesDir = join(root, 'releases');
const releasesJsonPath = join(releasesDir, 'releases.json');

const args = process.argv.slice(2);
/** Rebuilds the pages from releases.json without cutting a release. */
const pagesOnly = args[0] === '--pages';
const version = pagesOnly ? '' : (args[0] ?? '').replace(/^v/, '');
if (!pagesOnly && !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error(`Usage: node scripts/prepare-release.mjs <version> [--notes "..."]\nGot version: '${version}'`);
  process.exit(1);
}
const notesIndex = args.indexOf('--notes');
const notes = notesIndex !== -1 ? (args[notesIndex + 1] ?? '') : '';

const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
if (!pagesOnly && packageVersion !== version) {
  console.error(`Version mismatch: package.json has ${packageVersion}, release is ${version}.`);
  process.exit(1);
}

// 1. copy build artifacts
const folder = pagesOnly ? '' : join(releasesDir, version.replaceAll('.', '_'));
if (!pagesOnly) {
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
}

// 2. record release notes
const releases = JSON.parse(readFileSync(releasesJsonPath, 'utf8'));
/** 2.0.0-rc1 is a candidate for 2.0.0, and carries whatever 2.0.0 says. */
const base = v => v.split('-')[0];
/** An entry is `{summary, features, performance, fixes, vega}`; a bare string is the old shape. */
const entry = v => {
  const raw = releases[v] ?? releases[base(v)];
  return typeof raw === 'string' ? { summary: raw } : (raw ?? {});
};
if (!pagesOnly && (notes || (releases[version] === undefined && releases[base(version)] === undefined))) {
  releases[version] = {
    vega: Number(version.split('.')[0]) >= 2 ? 6 : 5,
    summary: '',
    features: [],
    performance: [],
    fixes: [],
    ...(typeof releases[version] === 'object' ? releases[version] : {}),
    ...(notes ? { summary: notes } : {}),
  };
}
writeFileSync(releasesJsonPath, `${JSON.stringify(releases, null, 2)}\n`);

// 3. regenerate versions.js (newest first)
const escapeHtml = s =>
  String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Release notes are escaped, then the two tags the existing notes use are let back through. */
const notesHtml = s =>
  escapeHtml(s)
    .replace(/&lt;br\s*\/?&gt;/g, '<br />')
    .replace(/&lt;(\/?)code&gt;/g, '<$1code>');

/** Replaces what sits between `<!-- name:start -->` and `<!-- name:end -->`. */
const splice = (text, path, name, body) => {
  const open = `<!-- ${name}:start -->`;
  const close = `<!-- ${name}:end -->`;
  const a = text.indexOf(open);
  const b = text.indexOf(close);
  if (a < 0 || b < 0 || b < a) {
    throw new Error(`${path} is missing the ${open} ... ${close} markers`);
  }
  return text.slice(0, a + open.length) + body + text.slice(b);
};

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

// releases.json can carry notes for a version before its build is hosted, and
// a row linking at a folder that is not there yet would only 404. The release
// run copies the bundle first, so by then the version shows up on its own.
const hosted = v => existsSync(join(releasesDir, v.replaceAll('.', '_'), 'vega-webgpu-renderer.js'));
/**
 * Versions with a folder on disk. An rc has no entry of its own, so the
 * directory is the only record that it is hosted. The folder name swaps dots
 * for underscores, and a prerelease suffix never contains one.
 */
const hostedDirs = () =>
  readdirSync(releasesDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(join(releasesDir, d.name, 'vega-webgpu-renderer.js')))
    .map(d => d.name.replaceAll('_', '.'));
const prerelease = v => v.includes('-');
const all = [...new Set(Object.keys(releases).concat(hostedDirs()))].sort(byVersionDesc);
const versions = all.filter(hosted);
/**
 * An rc is a throwaway for checking the pipeline, so the table lists only the
 * newest one for a version, and none at all once that version has shipped.
 */
const listed = versions.filter(v => {
  if (!prerelease(v)) {
    return true;
  }
  if (versions.includes(base(v))) {
    return false;
  }
  return versions.find(o => prerelease(o) && base(o) === base(v)) === v;
});
/** Written up but not hosted, which is what the note under the table says. */
const pending = Object.keys(releases)
  .filter(v => !hosted(v) && !versions.some(h => base(h) === v))
  .sort(byVersionDesc);
writeFileSync(
  join(releasesDir, 'versions.js'),
  `const vegaWebGPURendererVersions = [${listed.map(v => `'${v}'`).join(', ')}];\n`,
);

// 4. splice the version rows and the date into releases/index.html
// The page is hand written, so only the marked regions are generated.
const rows = listed
  .map(v => {
    const href = `./releases/${v.replaceAll('.', '_')}/vega-webgpu-renderer.js`;
    const e = entry(v);
    return `              <tr>
                <td><a href="./releases/${v.replaceAll('.', '_')}/">${v}</a></td>
                <td>${notesHtml(e.summary ?? '')}${prerelease(v) ? ' <em>(prerelease)</em>' : ''}${
                  e.vega === 5 ? ' <em>(needs Vega 5)</em>' : ''
                }</td>
                <td><a href="${href}">js</a> <a href="${href.replace('.js', '.min.js')}">min</a></td>
              </tr>`;
  })
  .join('\n');

// the project page is the site's front page, so it sits at the repo root
const indexPath = join(root, 'index.html');
let page = readFileSync(indexPath, 'utf8');
page = splice(
  page,
  indexPath,
  'versions',
  `
${rows}
              `,
);
const pendingNote = pending.length
  ? `
        <p class="note">
          ${pending.join(' and ')} ${pending.length > 1 ? 'are' : 'is'} written up but not
          hosted yet. Build from source with the steps above to try ${pending.length > 1 ? 'them' : 'it'}.
        </p>
      `
  : '\n      ';
// the copy and paste snippet points at the newest stable build. An rc is
// hosted so it can be tried, not so it can be the one people paste.
const stable = listed.find(v => !prerelease(v));
if (stable) {
  page = splice(page, indexPath, 'latest', stable.replaceAll('.', '_'));
}
page = splice(page, indexPath, 'pending', pendingNote);
page = splice(page, indexPath, 'updated', new Date().toISOString().slice(0, 10));
writeFileSync(indexPath, page);

// 5. one page per release, so a version in the table has somewhere to point
const list = (title, items) =>
  items?.length
    ? [`        <h2>${title}</h2>`, '        <ul>']
        .concat(items.map(i => `          <li>${notesHtml(i)}</li>`))
        .concat('        </ul>')
        .join('\n')
    : '';

for (const v of versions) {
  const e = entry(v);
  const dir = v.replaceAll('.', '_');
  const body = [list('Features', e.features), list('Performance', e.performance), list('Fixes', e.fixes)]
    .filter(Boolean)
    .join('\n\n');
  const vegaMajor = e.vega ?? (Number(v.split('.')[0]) >= 2 ? 6 : 5);
  // the 1.x releases predate the esm output, so the button would 404
  const esm = existsSync(join(releasesDir, dir, 'vega-webgpu-renderer.module.js'))
    ? '<a class="btn" href="./vega-webgpu-renderer.module.js">ESM build</a>'
    : '';
  const sub = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="../index.css" />
    <title>vega-webgpu-renderer ${v}</title>
  </head>
  <body>
    <header class="slim">
      <div class="wrap">
        <p class="eyebrow"><a href="../../">vega-webgpu-renderer</a></p>
        <h1>Version ${v}</h1>
        <p class="lede">${notesHtml(e.summary ?? '')}</p>
        <p class="actions">
          <a class="btn primary" href="./vega-webgpu-renderer.js">vega-webgpu-renderer.js</a>
          <a class="btn" href="./vega-webgpu-renderer.min.js">vega-webgpu-renderer.min.js</a>
          ${esm}
          <a class="btn" href="../marks.html?build=${v}">Try it</a>
        </p>
      </div>
    </header>

    <main class="wrap">
      <section>
        <h2>Load it</h2>
        <p>
          This build targets <strong>Vega ${vegaMajor}</strong>. Loaded next to a different major version of Vega it
          throws when it registers itself.
        </p>
        <pre><code>&lt;script src="https://cdn.jsdelivr.net/npm/vega@${vegaMajor}/build/vega.min.js"&gt;&lt;/script&gt;
&lt;script src="https://kanadaat.github.io/vega-webgpu/releases/${dir}/vega-webgpu-renderer.min.js"&gt;&lt;/script&gt;</code></pre>
      </section>

      <section>
${body || '        <p class="note">Nothing further was recorded for this release.</p>'}
      </section>
    </main>

    <footer>
      <div class="wrap">
        <p>
          <a href="../../">Project page</a>
          <a href="../../#versions">All versions</a>
          <a href="../marks.html?build=${v}">Mark playground</a>
          <a href="https://github.com/KaNaDaAT/vega-webgpu">GitHub</a>
          <a href="../impressum.html">Impressum</a>
        </p>
        <p class="madewith">
          Built to show the work and to be useful, with the help of
          <a href="https://claude.com/claude-code">Claude</a>.
        </p>
      </div>
    </footer>
  </body>
</html>
`;
  mkdirSync(join(releasesDir, dir), { recursive: true });
  writeFileSync(join(releasesDir, dir, 'index.html'), sub);
}

// Prettier over the generated html, so a run never leaves the tree dirty.
try {
  // releases.json and versions.js too: this script writes LF and the repo
  // keeps CRLF in the working tree, so without prettier they always read dirty
  const targets = ['index.html', 'releases/releases.json', 'releases/versions.js'].concat(
    versions.map(v => `releases/${v.replaceAll('.', '_')}/index.html`),
  );
  execFileSync('npx', ['prettier', '--write', '--log-level', 'warn', ...targets], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
} catch {
  console.warn('prettier is not available, the generated html is left unformatted');
}

console.log(pagesOnly ? `Rebuilt pages for ${versions.length} versions` : `Prepared release ${version} in ${folder}`);
