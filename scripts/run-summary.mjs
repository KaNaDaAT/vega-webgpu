/**
 * The markdown a CI run shows on its own page, written to GITHUB_STEP_SUMMARY.
 *
 * A run leaves two zips behind and nothing that says where to look, so this
 * names the cases over their budgets, links each one in the hosted gallery and
 * links the zips themselves, and lists what the run did not gate. A failure or
 * a skip is only loud if somebody reading the run can see it without
 * downloading anything.
 */
import { pathToFileURL } from 'node:url';
import { readManifest } from './paths.mjs';
import '../test/measures.js';

/** The suite's gate, which test/measures.js hangs off the global for the pages that load it too. */
const { failures, describe } = globalThis.RenderMeasures;

/** The deployed gallery, which pages.yml publishes beside the site. */
const GALLERY = 'https://kanadaat.github.io/vega-webgpu/gallery/';

/**
 * `env` carries the run: RENDER_DPR, the GITHUB_ variables, and REPORT_URL and
 * IMAGES_URL, which ci.yml takes from the two uploads.
 */
function summary({ manifest = readManifest(), env = process.env } = {}) {
  const dpr = env.RENDER_DPR ?? '1';
  const out = [`## Render suite, dpr ${dpr}`, ''];

  // the pages deploy records the same commit at dpr 1, and keeps the last ten
  const sha = env.GITHUB_SHA?.slice(0, 7);
  const onMain = env.GITHUB_EVENT_NAME === 'push' && env.GITHUB_REF === 'refs/heads/main';
  const hosted = onMain && sha && dpr === '1' ? `${GALLERY}?run=${sha}` : null;
  const zips = [
    env.REPORT_URL && `[the report](${env.REPORT_URL}), every test with its pngs attached`,
    env.IMAGES_URL &&
      `[the images](${env.IMAGES_URL}), which \`npm run gallery\` browses once unzipped into test/render/output`,
  ].filter(Boolean);

  if (!manifest) {
    out.push('No gallery manifest was written, so the run did not reach the comparison cases.');
    return out.join('\n');
  }
  const cases = manifest.cases ?? [];
  const failed = cases.map(c => ({ c, over: failures(c) })).filter(f => f.over.length);
  const skipped = cases.filter(c => c.skip);
  out.push(
    `${cases.length} cases compared, ${failed.length ? `**${failed.length} over budget**` : 'none over budget'}, ` +
      `${skipped.length} recorded but not gated.`,
    '',
  );

  if (failed.length > 0) {
    out.push('### Over budget', '', `| case | what failed |${hosted ? ' gallery |' : ''}`);
    out.push(`| --- | --- |${hosted ? ' --- |' : ''}`);
    for (const { c, over } of failed.sort((a, b) => a.c.name.localeCompare(b.c.name))) {
      const link = hosted ? ` [open](${hosted}#${encodeURIComponent(c.file)}) |` : '';
      out.push(`| \`${c.name}\` | ${over.map(describe).join(', and ')} |${link}`);
    }
    out.push(
      '',
      hosted
        ? 'The gallery recorded this commit itself, so its numbers can sit a little either side of these.'
        : `The hosted gallery records main at dpr 1 only, so this run's pictures are in ${zips.length ? 'the images below' : 'its render-images artifact'}.`,
      '',
    );
  }

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
    onMain && sha
      ? `This commit's gallery is at <${GALLERY}?run=${sha}> once its Pages deploy finishes, recorded there at dpr 1.`
      : `The browsable gallery is at <${GALLERY}>, with the last ten runs on main and every release. A run outside main is not in it.`,
    '',
    zips.length
      ? `For this run itself: ${zips.join(', and ')}.`
      : 'For this run itself, download the `render-report` artifact above and open `index.html`, or `render-images` for ' +
          'the raw pngs.',
  );
  return out.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${summary()}\n`);
}

export { summary };
