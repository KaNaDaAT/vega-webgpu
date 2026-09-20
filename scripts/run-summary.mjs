/**
 * The markdown a CI run shows on its own page, written to GITHUB_STEP_SUMMARY.
 *
 * A run leaves two zips behind and nothing that says where to look, so this
 * names the hosted gallery and lists what the run did not gate. A skip is only
 * loud if somebody reading the run can see it without downloading anything.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = join(root, 'test', 'render', 'output', 'index.json');

/** The deployed gallery, which pages.yml publishes beside the site. */
const GALLERY = 'https://kanadaat.github.io/vega-webgpu/gallery/';

function summary() {
  const dpr = process.env.RENDER_DPR ?? '1';
  const out = [`## Render suite, dpr ${dpr}`, ''];

  if (!existsSync(manifest)) {
    out.push('No gallery manifest was written, so the run did not reach the comparison cases.');
    return out.join('\n');
  }
  const cases = JSON.parse(readFileSync(manifest, 'utf8')).cases ?? [];
  const skipped = cases.filter(c => c.skip);
  out.push(`${cases.length} cases compared, ${skipped.length} of them recorded but not gated.`, '');

  if (skipped.length > 0) {
    out.push('### Not gated', '', '| case | queued for | what is wrong | differing |', '| --- | --- | --- | --- |');
    for (const c of skipped.sort((a, b) => a.skip.milestone.localeCompare(b.skip.milestone))) {
      const tag = c.skip.milestone === 'upstream' ? 'upstream, not ours' : `todo ${c.skip.milestone}`;
      out.push(`| \`${c.name}\` | ${tag} | ${c.skip.summary} | ${(c.diff * 100).toFixed(3)}% |`);
    }
    out.push('', 'Each is drawn and recorded like any other case, so the gallery shows the difference it names.');
    out.push('');
  }

  out.push(
    `The browsable gallery for the default branch is at <${GALLERY}>. It is rebuilt on every push to main, so it ` +
      'shows that commit rather than this run. For this run, download the `render-report` artifact above and open ' +
      '`index.html`, or `render-images` for the raw pngs.',
  );
  return out.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${summary()}\n`);
}

export { summary };
