/**
 * Assembles a self-contained render gallery from the pngs a run left in
 * test/render/output, for hosting alongside a release.
 *
 * Every case ships, so a snapshot is the whole corpus as that version drew it
 * rather than a selection somebody has to justify later. That is about 18MB of
 * pngs per release against a 19MB repository, which is the price of being able
 * to answer what a version looked like after the fact.
 *
 * The diff pngs are the one thing left out, and that is not a trim: the gallery
 * computes the difference from the pair itself, so a stored diff is both unused
 * and frozen at one threshold.
 *
 * --mean and --max-cases narrow it when a smaller snapshot is wanted.
 *
 *   node scripts/gallery-snapshot.mjs <version> [--mean 2] [--max-cases 40]
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(args[i + 1]);
};

const version = args.find(a => !a.startsWith('-'));
if (!version) {
  console.error('\n  Usage: node scripts/gallery-snapshot.mjs <version> [--out dir] [--mean 2] [--max-cases 40]\n');
  process.exit(1);
}

/** Where to assemble it. The pages deploy stages the site somewhere else. */
const outArg = (() => {
  const i = args.indexOf('--out');
  return i === -1 ? null : args[i + 1];
})();

const MEAN = flag('mean', 0);
const MAX_CASES = flag('max-cases', 0);

const outputDir = join(root, 'test', 'render', 'output');
const manifestPath = join(outputDir, 'index.json');
if (!existsSync(manifestPath)) {
  console.error(
    [
      '',
      `  ${manifestPath} is not there, so there is nothing to snapshot.`,
      '',
      '  Record a run first:',
      '',
      '    npm run gallery:record',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const dest = outArg ? resolve(root, outArg) : join(root, 'releases', version.replaceAll('.', '_'), 'gallery');

/** Worst first, so the order holds whether or not anything is narrowed. */
const ranked = [...manifest.cases].sort((a, b) => b.mean - a.mean || b.quad - a.quad);
const overThreshold = MEAN > 0 ? ranked.filter(c => c.mean > MEAN) : ranked;
const kept = MAX_CASES > 0 ? overThreshold.slice(0, MAX_CASES) : overThreshold;
if (!kept.length) {
  console.log(`\n  Nothing differs by more than ${MEAN}, so there is no gallery to publish.\n`);
  process.exit(0);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(join(dest, 'output'), { recursive: true });

let bytes = 0;
const missing = [];
for (const c of kept) {
  for (const kind of ['canvas', 'webgpu']) {
    const from = join(outputDir, `${c.file}-${kind}.png`);
    if (!existsSync(from)) {
      missing.push(`${c.file}-${kind}.png`);
      continue;
    }
    const to = join(dest, 'output', `${c.file}-${kind}.png`);
    copyFileSync(from, to);
    bytes += statSync(to).size;
  }
}
if (missing.length) {
  console.error(
    `\n  These are in the manifest but not on disk, so the run was partial:\n    ${missing.join('\n    ')}\n`,
  );
  process.exit(1);
}

/**
 * `snapshot` is what tells the page it is hosted: there is no dev build and no
 * spec next to it, so live mode cannot run and says so rather than failing.
 */
writeFileSync(
  join(dest, 'output', 'index.json'),
  `${JSON.stringify(
    {
      generated: manifest.generated,
      run: manifest.run ?? null,
      settings: manifest.settings ?? null,
      snapshot: { version, of: manifest.cases.length, partial: kept.length < manifest.cases.length },
      cases: kept,
    },
    null,
    2,
  )}\n`,
);

// The page and its two shared files, flattened so the directory stands alone.
const page = readFileSync(join(root, 'test', 'render', 'gallery.html'), 'utf8')
  .replace('../compare-ui.css', './compare-ui.css')
  .replace('../compare-core.js', './compare-core.js');
writeFileSync(join(dest, 'index.html'), page);
copyFileSync(join(root, 'test', 'compare-ui.css'), join(dest, 'compare-ui.css'));
copyFileSync(join(root, 'test', 'compare-core.js'), join(dest, 'compare-core.js'));
copyFileSync(join(root, 'test', 'render', 'gallery.js'), join(dest, 'gallery.js'));

const total = readdirSync(join(dest, 'output')).length;
console.log(
  [
    '',
    `  ${outArg ?? `releases/${version.replaceAll('.', '_')}/gallery`}`,
    `    ${kept.length} of ${manifest.cases.length} cases${kept.length < manifest.cases.length ? ` over ${MEAN} mean channel error` : ', the whole corpus'}`,
    `    ${total} files, ${(bytes / 1e6).toFixed(1)}MB of pngs`,
    `    worst kept ${kept[0].name} at mean ${kept[0].mean.toFixed(2)}, lightest ${kept[kept.length - 1].name} at ${kept[kept.length - 1].mean.toFixed(2)}`,
    '',
  ].join('\n'),
);
