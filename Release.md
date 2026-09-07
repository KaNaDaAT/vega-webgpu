# Releasing

One command does it:

```bash
npm run release
```

That releases the version already in `package.json`. To release a different one, name it and the script writes it into `package.json` for you:

```bash
npm run release -- 2.1.0
npm run release -- 2.1.0-rc1
```

The tag is the last thing it does, and only once everything the tag points at is on the remote. Nothing here needs a build: the workflow the tag starts builds the bundles, commits them to `main` for GitHub Pages, creates the GitHub release and publishes to npm.

## Options

| Option | What it does |
| --- | --- |
| `--help` | The same summary, from the command itself. |
| `--check` | Runs every check and stops before committing anything. |
| `--host` | Builds and commits the hosted files from here, instead of leaving that to the workflow. Use it to see the site exactly as it will look. |
| `--skip-tests` | Does not run the suite. |
| `--yes` | Answers the "the suite is red, continue?" prompt with yes. |

## What it does, in order

1. **Refuses to start on unrelated uncommitted work.** It owns `package.json`, `package-lock.json` and `releases/releases.json` and will commit those. Anything else dirty has to be committed or stashed first, or the tag would point at a tree that was never the one under test.
2. **Bumps `package.json`** when you named a version that differs. It says so, and commits it later itself. The release workflow refuses a tag that disagrees with `package.json`, so this is the check that used to fail last.
3. **Checks `releases/releases.json` describes the version.** If there is no entry it prints the shape to paste and stops. A blank summary fails. A final release listing no features, performance notes or fixes fails; a prerelease only warns, since an rc may go out thin.
4. **Runs the suite.** If it is red you get the output and a yes or no question rather than a silent pass.
5. **Commits and pushes** whatever it changed, as `release: <version>`.
6. **Tags and pushes the tag.** If that push fails the tag is deleted again, so running the command a second time is safe.

## Writing the notes

`releases/releases.json` is the only place a version is described. The version table on the front page, the note under it, the per-release page and the GitHub release all read from it.

```json
"2.1.0": {
  "vega": 6,
  "summary": "One sentence. This is the whole Changes column on the front page.",
  "features": ["..."],
  "performance": ["..."],
  "fixes": ["..."]
}
```

A version can be written up long before it ships. It only appears on the site once its bundle is actually hosted, so notes can land with the work rather than at release time.

## Prereleases

An rc needs no notes of its own. `2.1.0-rc1` is a candidate for `2.1.0` and reads whatever `2.1.0` says, because a candidate exists to put the pipeline through its paces rather than to be described twice. Write `2.1.0` once, cut as many candidates as you like, then cut the real thing.

A version with a suffix is treated as a candidate throughout:

- hosted and testable, with its own page and a slot in both version pickers
- labelled `(prerelease)` on the version table
- published to npm under `next`, so `npm install` keeps giving people the stable build and `npm install vega-webgpu-renderer@next` opts in
- flagged on the GitHub release, so it does not read as the latest
- ignored by the copy and paste snippet on the front page, which tracks the newest stable release
- listed only while it is the newest candidate for its version, and dropped from the table entirely once that version ships

Each rc commits its bundles to `main` permanently, since that is how Pages serves them. Pruning old rc folders once the final ships is a reasonable habit.

## Regenerating the site without releasing

```bash
npm run pages
```

Rebuilds the front page, the version table and every per-release page from `releases/releases.json`, and formats what it writes. Safe to run any time.

## If something goes wrong

A tag that was pushed by mistake:

```bash
git push origin :refs/tags/v2.1.0
git tag -d v2.1.0
```

Deleting the tag does not delete the GitHub release or an npm publish. Remove the release from the GitHub UI. An npm version can never be reused, so the fix there is to publish the next patch.
