/**
 * Cuts a release.
 *
 *   npm run release                    the version in package.json
 *   npm run release -- 2.1.0-rc1       an explicit one
 *   npm run release -- --check         everything except the tag and the push
 *   npm run release -- --host          build and commit the hosted files too
 *
 * Checks that releases.json describes the version, runs the suite, and pushes
 * the tag. The workflow the tag starts is what builds the bundles, commits
 * them to main and publishes, so nothing here needs a build.
 *
 * `--host` does that hosting from here instead, for when you want to see the
 * site exactly as it will look before the tag goes out.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const has = flag => args.includes(flag);
const checkOnly = has('--check');
const host = has('--host');
const assumeYes = has('--yes');
const skipTests = has('--skip-tests');

const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const version = (args.find(a => !a.startsWith('--')) ?? packageVersion).replace(/^v/, '');
const isPrerelease = version.includes('-');
const tag = `v${version}`;

const say = (...lines) => console.log(`  ${lines.join('\n  ')}`);
const die = (...lines) => {
  console.error(`\n  ${lines.join('\n  ')}\n`);
  process.exit(1);
};
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
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

// 1. the version itself
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) {
  die(`'${version}' is not a version.`, 'Expected something like 2.0.0 or 2.1.0-rc1.');
}
if (version !== packageVersion) {
  die(
    `package.json is on ${packageVersion}, you asked for ${version}.`,
    'The workflow refuses a tag that disagrees with package.json, so bump it first:',
    '',
    `    npm version ${version} --no-git-tag-version`,
  );
}

// 2. the notes, which the site and the GitHub release both read
const releases = JSON.parse(readFileSync(join(root, 'releases', 'releases.json'), 'utf8'));
const raw = releases[version];
const entry = typeof raw === 'string' ? { summary: raw } : raw;
if (!entry) {
  die(
    `releases/releases.json has nothing for ${version}.`,
    'The version table, the release page and the GitHub release all read from it.',
    'Add an entry shaped like this, then run this again:',
    '',
    `    "${version}": {`,
    `      "vega": ${Number(version.split('.')[0]) >= 2 ? 6 : 5},`,
    '      "summary": "One sentence on what this release is.",',
    '      "features": [],',
    '      "performance": [],',
    '      "fixes": []',
    '    }',
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

// 3. the tree and the tag
if (git('status', '--porcelain', '--untracked-files=no')) {
  die('The working tree has uncommitted changes.', 'A tag should point at something you can get back to.');
}
const existing = git('tag', '--list', tag);
if (existing) {
  die(`${tag} already exists locally.`, `Delete it first if you mean to move it: git tag -d ${tag}`);
}

console.log(`\n  ${version}${isPrerelease ? '  (prerelease)' : ''}`);
say(summary, `${counts[0]} features, ${counts[1]} performance notes, ${counts[2]} fixes`, '');

// 4. the suite
if (skipTests) {
  say('Skipping the tests because you asked.', '');
} else {
  say('Running the suite. This takes a few minutes.', '');
  const result = run('npm', ['test']);
  if (result.status !== 0) {
    console.log('');
    if (!(await confirm(`The suite is red. Tag ${version} anyway?`))) {
      die('Stopped. Nothing was tagged.');
    }
    say('Continuing with a red suite.', '');
  }
}

// 5. optionally host from here rather than leaving it to the workflow
if (host) {
  say('Building and staging the hosted files.', '');
  if (run('npm', ['run', 'build']).status !== 0) {
    die('The build failed.');
  }
  if (run('node', ['scripts/prepare-release.mjs', version]).status !== 0) {
    die('Preparing the site failed.');
  }
  if (git('status', '--porcelain', '--untracked-files=no') || git('status', '--porcelain')) {
    run('git', ['add', 'releases', 'index.html']);
    run('git', ['commit', '-m', `release: host ${version}`]);
    say('', `Committed the hosted files for ${version}.`, '');
  } else {
    say('The site already had everything for this version.', '');
  }
}

if (checkOnly) {
  say(`Everything checks out. Drop --check to tag ${tag} and push it.`, '');
  process.exit(0);
}

// 6. tag and push
say(`Tagging ${tag} and pushing.`, '');
run('git', ['tag', '-a', tag, '-m', summary]);
if (run('git', ['push', 'origin', 'HEAD', tag]).status !== 0) {
  run('git', ['tag', '-d', tag]);
  die('The push failed, so the tag was removed again.');
}

console.log(
  [
    '',
    `  ${tag} is pushed.`,
    '',
    '  .github/workflows/release.yml now builds the bundles, commits them to',
    '  main, creates the GitHub release and publishes to npm.',
    '',
    `    gh run watch --repo $(git config --get remote.origin.url | sed 's#.*github.com[:/]##; s#\\.git$##')`,
    '',
  ].join('\n'),
);
