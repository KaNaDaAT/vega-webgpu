/**
 * Adds the run in test/render/output to the gallery's history of runs, for
 * pages.yml to host beside the gallery:
 *
 *   node scripts/gallery-history.mjs --out <dir> [--from <url>] [--keep 10] [--release 2.1.0]
 *
 * `--from` is where the history is deployed now. The runs before this one come
 * from there, so nothing outside the site holds them. A png is stored once,
 * under the hash of its bytes, and a run is its manifest plus the hash of each
 * png it drew. The runner renders deterministically, so a run that changed no
 * pixels adds no pngs.
 *
 * `--release` marks the run as the one a release was hosted from. Past the last
 * `--keep` runs, every full release keeps its run, and the newest rc keeps its
 * until the next rc.
 *
 *   <out>/index.json       the runs, newest first
 *   <out>/<id>.json        a run's manifest, with `images` from png name to hash
 *   <out>/png/<hash>.png
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = name => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
};

const outArg = arg('out');
const release = arg('release') || null;
if (!outArg || (release && !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(release))) {
  console.error(
    '\n  Usage: node scripts/gallery-history.mjs --out <dir> [--from <url>] [--keep 10] [--release 2.1.0]\n',
  );
  process.exit(1);
}
const out = resolve(root, outArg);
const from = arg('from')?.replace(/\/?$/, '/') ?? null;
const KEEP = Number(arg('keep') ?? 10);
/** A history in another format is dropped rather than misread. */
const FORMAT = 1;

const outputDir = join(root, 'test', 'render', 'output');
const pngDir = join(out, 'png');
const hashOf = bytes => createHash('sha1').update(bytes).digest('hex').slice(0, 16);
const pngPath = hash => join(pngDir, `${hash}.png`);

rmSync(out, { recursive: true, force: true });
mkdirSync(pngDir, { recursive: true });

/** The run this workflow recorded, or null when the record step left none. */
function thisRun() {
  const path = join(outputDir, 'index.json');
  if (!existsSync(path)) {
    return null;
  }
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  const images = {};
  for (const c of manifest.cases) {
    // the gallery computes the diff from the pair, so the diff png stays behind
    for (const kind of ['canvas', 'webgpu']) {
      const name = `${c.file}-${kind}.png`;
      const file = join(outputDir, name);
      if (!existsSync(file)) {
        continue;
      }
      const bytes = readFileSync(file);
      const hash = hashOf(bytes);
      images[name] = hash;
      if (!existsSync(pngPath(hash))) {
        writeFileSync(pngPath(hash), bytes);
      }
    }
  }
  const stamp = (manifest.generated ?? new Date().toISOString()).replace(/\D/g, '').slice(0, 12);
  const id = manifest.run?.sha ? manifest.run.sha.slice(0, 7) : `local-${stamp}`;
  return { id, manifest: { ...manifest, release, images } };
}

/** The runs kept past the last few, out of a list ordered newest first. */
function pinned(runs) {
  const ids = new Set();
  const seen = new Set();
  let rc = false;
  for (const r of runs) {
    if (!r.release || seen.has(r.release)) {
      continue;
    }
    seen.add(r.release);
    if (!r.release.includes('-')) {
      ids.add(r.id);
    } else if (!rc) {
      rc = true;
      ids.add(r.id);
    }
  }
  return ids;
}

/**
 * Pages caches for ten minutes, and a stale index would drop the run before.
 * Only a 404 means there is nothing there. Anything else is retried, since
 * giving up starts the history again and loses the runs it held.
 */
async function getJson(url) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${url}?t=${Date.now()}`);
      if (res.ok) {
        return await res.json();
      }
      last = new Error(`${res.status} for ${url}`);
      if (res.status === 404) {
        break;
      }
    } catch (err) {
      last = err;
    }
    if (attempt < 2) {
      await delay(2000 * (attempt + 1));
    }
  }
  throw last;
}

async function fetchPng(hash) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${from}png/${hash}.png`);
      if (res.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (hashOf(bytes) === hash) {
          writeFileSync(pngPath(hash), bytes);
          return true;
        }
      }
    } catch {
      // retried once, then the run that needs it is dropped
    }
  }
  return false;
}

async function eachLimited(items, limit, fn) {
  const queue = [...items];
  const worker = async () => {
    while (queue.length) {
      await fn(queue.shift());
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
}

/** The deployed runs worth keeping, with their pngs fetched into place. */
async function earlierRuns(current) {
  if (!from) {
    return [];
  }
  let listed;
  try {
    const index = await getJson(`${from}index.json`);
    if (index.format !== FORMAT) {
      console.log(`  The deployed history is format ${index.format}, not ${FORMAT}, so it starts again.`);
      return [];
    }
    const others = index.runs.filter(r => r.id !== current?.id);
    const recent = new Set(others.slice(0, KEEP - (current ? 1 : 0)).map(r => r.id));
    const mine = current ? [{ id: current.id, release: current.manifest.release }] : [];
    const pins = pinned([...mine, ...others]);
    listed = others.filter(r => recent.has(r.id) || pins.has(r.id));
  } catch (err) {
    // a history lost to anything but a 404 should show on the run page
    const lost = !String(err.message).startsWith('404') && process.env.GITHUB_ACTIONS;
    console.log(`${lost ? '::warning::' : '  '}No history at ${from} (${err.message}), so it starts with this run.`);
    return [];
  }

  const runs = [];
  for (const r of listed) {
    try {
      const manifest = await getJson(`${from}${r.id}.json`);
      if (!manifest.cases || !manifest.images) {
        throw new Error('its manifest has no cases or images');
      }
      runs.push({ id: r.id, manifest });
    } catch (err) {
      console.log(`  Dropped ${r.id}: ${err.message}`);
    }
  }
  const missing = new Set(runs.flatMap(r => Object.values(r.manifest.images)).filter(h => !existsSync(pngPath(h))));
  const failed = new Set();
  await eachLimited(missing, 8, async hash => {
    if (!(await fetchPng(hash))) {
      failed.add(hash);
    }
  });
  return runs.filter(r => {
    const broken = Object.values(r.manifest.images).some(h => failed.has(h));
    if (broken) {
      console.log(`  Dropped ${r.id}: some of its pngs could not be fetched.`);
    }
    return !broken;
  });
}

const current = thisRun();
const runs = [...(current ? [current] : []), ...(await earlierRuns(current))];

// a run dropped after its pngs arrived leaves some nothing points at
const used = new Set(runs.flatMap(r => Object.values(r.manifest.images)));
for (const f of readdirSync(pngDir)) {
  if (!used.has(f.replace(/\.png$/, ''))) {
    rmSync(join(pngDir, f));
  }
}

for (const r of runs) {
  writeFileSync(join(out, `${r.id}.json`), `${JSON.stringify(r.manifest)}\n`);
}
writeFileSync(
  join(out, 'index.json'),
  `${JSON.stringify(
    {
      format: FORMAT,
      runs: runs.map(({ id, manifest: m }) => ({
        id,
        sha: m.run?.sha ?? null,
        version: m.run?.version ?? null,
        release: m.release ?? null,
        url: m.run?.url ?? null,
        generated: m.generated ?? null,
        cases: m.cases.length,
      })),
    },
    null,
    2,
  )}\n`,
);

const pngs = readdirSync(pngDir);
const bytes = pngs.reduce((sum, f) => sum + statSync(join(pngDir, f)).size, 0);
const earlier = new Set(runs.slice(current ? 1 : 0).flatMap(r => Object.values(r.manifest.images)));
const fresh = current ? new Set(Object.values(current.manifest.images).filter(h => !earlier.has(h))).size : 0;
const releases = runs.map(r => r.manifest.release).filter(Boolean);
console.log(
  [
    '',
    `  ${relative(root, out) || '.'}`,
    `    ${runs.length} run${runs.length === 1 ? '' : 's'}${runs.length ? `, newest ${runs[0].id}` : ''}`,
    `    releases kept: ${releases.length ? releases.join(', ') : 'none'}`,
    `    ${pngs.length} pngs, ${(bytes / 1e6).toFixed(1)}MB${current ? `, ${fresh} of them new in this run` : ''}`,
    '',
  ].join('\n'),
);
