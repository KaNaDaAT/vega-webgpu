/**
 * Cuts a release. See Release.md, or run `npm run release -- --help`.
 *
 * The point of this script is that a tag is never the first thing that finds a
 * mistake. It bumps package.json for you, refuses to go on until releases.json
 * describes the version, runs the suite, and commits and pushes what it
 * changed before the tag exists at all.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const has = flag => args.includes(flag);

const HELP = `
  npm run release [-- <version>] [options]

  Cuts a release: bumps package.json, checks the notes, runs the suite,
  commits and pushes what changed, then tags and pushes the tag. The workflow
  the tag starts builds the bundles, hosts them and publishes.

  <version>        2.1.0 or 2.1.0-rc1. Defaults to the version in package.json.
                   An explicit one that differs is written to package.json.

  --check          Stop before committing anything. Everything else still runs.
  --host           Build and commit the hosted files from here, instead of
                   leaving that to the workflow.
  --skip-tests     Do not run the suite.
  --yes            Answer the "the suite is red, continue?" prompt with yes.
  --help           This.

  A prerelease (2.1.0-rc1) is hosted and installable as @next, is labelled on
  the version table, and does not become the build the front page tells people
  to paste.
`;

if (has('--help') || has('-h')) {
  console.log(HELP);
  process.exit(0);
}

const checkOnly = has('--check');
const host = has('--host');
const assumeYes = has('--yes');
const skipTests = has('--skip-tests');

const pkgPath = join(root, 'package.json');
const releasesJsonPath = join(root, 'releases', 'releases.json');
const packageVersion = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
const asked = args.find(a => !a.startsWith('-'));
const version = (asked ?? packageVersion).replace(/^v/, '');
const isPrerelease = version.includes('-');
const tag = `v${version}`;

const say = (...lines) => console.log(`  ${lines.join('\n  ')}`);
const die = (...lines) => {
  console.error(`\n  ${lines.join('\n  ')}\n`);
  process.exit(1);
};
const gitRaw = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
const git = (...a) => gitRaw(...a).trim();
const run = (cmd, cmdArgs) =>
  spawnSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });

async function confirm(question) {
  if (assumeYes) {
    return true;
  }
  if (!process.stdin.isTTY) {
    say('Not a terminal and no --yes, so stopping here.');
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`  ${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return answer === 'y' || answer === 'yes';
}

/** The files this script is allowed to have dirty, because it commits them. */
const OWNED = ['package.json', 'package-lock.json', 'releases/releases.json'];
// Not git(): porcelain puts the status in the first two columns, so trimming
// the output eats the leading space of the first line and shifts the path.
const dirty = () =>
  gitRaw('status', '--porcelain', '--untracked-files=no')
    .split('\n')
    .filter(Boolean)
    .map(l => l.slice(3).trim());

if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) {
  die(`'${version}' is not a version.`, 'Expected something like 2.0.0 or 2.1.0-rc1.');
}

// Anything the script does not own has to be dealt with first, or the tag ends
// up pointing at a tree that was never the one under test.
const strays = dirty().filter(f => !OWNED.includes(f));
if (strays.length) {
  die(
    'These are uncommitted, and this script will not tag over them:',
    '',
    ...strays.map(f => `    ${f}`),
    '',
    'Commit or stash them first.',
  );
}

if (git('tag', '--list', tag)) {
  die(`${tag} already exists locally.`, `Delete it if you mean to move it:  git tag -d ${tag}`);
}

// 1. an explicit version is written into package.json rather than refused
let bumped = false;
if (version !== packageVersion) {
  say(`package.json is on ${packageVersion}, moving it to ${version}.`);
  if (run('npm', ['version', version, '--no-git-tag-version', '--allow-same-version']).status !== 0) {
    die('npm version failed, so package.json was left alone.');
  }
  bumped = true;
  say('package.json is bumped and not committed yet. This script commits it before it tags.', '');
}

// 2. the notes, which the site and the GitHub release both read
const releases = JSON.parse(readFileSync(releasesJsonPath, 'utf8'));
const raw = releases[version];
const entry = typeof raw === 'string' ? { summary: raw } : raw;
if (!entry) {
  die(
    `releases/releases.json has nothing for ${version}, so there is nothing to release yet.`,
    'The version table, the release page and the GitHub release all read from it.',
    '',
    'Write this, then run the same command again:',
    '',
    `    "${version}": {`,
    `      "vega": ${Number(version.split('.')[0]) >= 2 ? 6 : 5},`,
    '      "summary": "One sentence on what this release is.",',
    '      "features": [],',
    '      "performance": [],',
    '      "fixes": []',
    '    }',
    ...(bumped ? ['', `package.json is already on ${version}, so leave it be.`] : []),
  );
}
const summary = (entry.summary ?? '').trim();
if (!summary) {
  die(`The ${version} entry has no summary.`, 'That sentence is the whole Changes column on the front page.');
}
const counts = ['features', 'performance', 'fixes'].map(k => (entry[k] ?? []).length);
if (counts.reduce((a, b) => a + b, 0) === 0) {
  const lines = [
    `The ${version} entry lists no features, performance work or fixes.`,
    'Its release page would be a heading and nothing else.',
  ];
  if (isPrerelease) {
    console.warn(`\n  Warning: ${lines.join('\n  ')}\n  Continuing because ${version} is a prerelease.`);
  } else {
    die(...lines, '', 'A prerelease may go out thin, a final release should not.');
  }
}

console.log(`\n  ${version}${isPrerelease ? '  (prerelease)' : ''}`);
say(summary, `${counts[0]} features, ${counts[1]} performance notes, ${counts[2]} fixes`, '');

// 3. the suite
if (skipTests) {
  say('Skipping the suite because you asked.', '');
} else {
  say('Running the suite. This takes a few minutes.', '');
  if (run('npm', ['test']).status !== 0) {
    console.log('');
    if (!(await confirm(`The suite is red. Release ${version} anyway?`))) {
      die('Stopped. Nothing was committed or tagged.', ...(bumped ? [`package.json is still on ${version}.`] : []));
    }
    say('Continuing with a red suite.', '');
  }
}

// 4. optionally host from here rather than leaving it to the workflow
if (host) {
  say('Building and staging the hosted files.', '');
  if (run('npm', ['run', 'build']).status !== 0) {
    die('The build failed.');
  }
  if (run('node', ['scripts/prepare-release.mjs', version]).status !== 0) {
    die('Preparing the site failed.');
  }
}

if (checkOnly) {
  say(`Everything checks out. Drop --check to commit, tag ${tag} and push.`, '');
  process.exit(0);
}

// 5. commit and push what changed, so the tag lands on a commit the remote has
const pending = dirty();
const untracked = gitRaw('status', '--porcelain').split('\n').filter(Boolean);
if (pending.length || (host && untracked.length)) {
  say('Committing:', ...pending.map(f => `    ${f}`), '');
  run('git', ['add', 'package.json', 'package-lock.json', 'releases', 'index.html']);
  if (run('git', ['commit', '-m', `release: ${version}`]).status !== 0) {
    die('The commit failed.');
  }
}
if (run('git', ['push', 'origin', 'HEAD']).status !== 0) {
  die('Pushing the branch failed, so nothing was tagged.');
}

// 6. the tag, last, once everything it points at is on the remote
say('', `Tagging ${tag}.`, '');
run('git', ['tag', '-a', tag, '-m', summary]);
if (run('git', ['push', 'origin', tag]).status !== 0) {
  run('git', ['tag', '-d', tag]);
  die('Pushing the tag failed, so the tag was removed again.', 'The commit is pushed, so just run this again.');
}

console.log(
  [
    '',
    `  ${tag} is pushed.`,
    '',
    '  .github/workflows/release.yml now builds the bundles, hosts them on main,',
    '  creates the GitHub release, and publishes to npm when NPM_TOKEN is set.',
    '',
    '    gh run watch',
    '',
  ].join('\n'),
);
