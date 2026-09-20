import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { enums } from '../../scripts/vega-enums.mjs';
import { compareCase, renderInHarness, type RendererName, type RenderResult } from './compare.js';
import {
  QUAD_DELTA_DEFAULT,
  SCENE_CHECK_DEFAULT,
  SCENE_FLAT_MEAN_DEFAULT,
  SCENE_BIAS_DELTA_DEFAULT,
  SCENE_MEAN_DELTA_DEFAULT,
  quadDeltaOverrides,
  skippedScenes,
  renderScenes,
  sceneCheckOverrides,
  sceneFlatMeanOverrides,
  sceneBiasDeltaOverrides,
  sceneMeanDeltaOverrides,
} from './scenes.js';
import { TILE_CHECK_DEFAULT } from './specs.js';

/**
 * The fixture list is a directory read with nothing behind it, so an empty or
 * moved test/render/scenes generates no tests at all and the suite goes green
 * having compared nothing.
 */
test('there are fixtures to compare', () => {
  expect(renderScenes.length, 'test/render/scenes has no fixtures in it').toBeGreaterThan(10);
});

/** Every value any fixture sets a property to, read off the stored scenegraphs. */
function valuesInFixtures(props: string[]): Record<string, Set<string>> {
  const found: Record<string, Set<string>> = Object.fromEntries(props.map(p => [p, new Set<string>()]));
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') {
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key in found && (typeof value === 'string' || typeof value === 'number')) {
        found[key].add(String(value));
      }
      walk(value);
    }
  };
  for (const name of renderScenes) {
    walk(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'scenes', `${name}.json`), 'utf8')));
  }
  return found;
}

/**
 * Coverage of the values vega itself says a property takes, from the same
 * schema `releases/vega-enums.js` is generated out of. A mark property that
 * only one of its values is ever drawn with is a property where four fifths of
 * the parsing can break silently, and a vega release that adds a blend mode
 * should show up here rather than in a bug report.
 *
 * Only the properties vega's schema enumerates are checkable. It has no enum
 * for `interpolate` or for a symbol `shape`, and vega-scenegraph keeps both
 * lists private to their own modules, so those two are covered by
 * `line-interpolate`, `symbol-shapes` and `symbol-analytic` without anything
 * to hold them to. See README.md.
 */
test('every value vega enumerates is drawn by some fixture', () => {
  // align, baseline, direction, orient and fontWeight are listed for the axis,
  // legend and title as well as for a mark, and a fixture is a mark, so what
  // is checked here is the three that are mark properties throughout.
  const props = ['blend', 'strokeCap', 'strokeJoin'];
  const seen = valuesInFixtures(props);
  for (const prop of props) {
    const missing = (enums[prop] ?? []).filter(v => !seen[prop].has(v));
    expect(missing, `no fixture sets ${prop} to ${missing.join(', ')}`).toEqual([]);
  }
});

/** A fixture's own description, which says which mode or shape each part is. */
function sceneNote(name: string): string {
  try {
    const file = join(dirname(fileURLToPath(import.meta.url)), 'scenes', `${name}.json`);
    return (JSON.parse(readFileSync(file, 'utf8')).description as string) ?? '';
  } catch {
    return '';
  }
}

function renderScene(page: Page, sceneName: string, renderer: RendererName): Promise<RenderResult> {
  const url = `/test/render/scene-harness.html?scene=${encodeURIComponent(sceneName)}&renderer=${renderer}`;
  return renderInHarness(page, url, renderer);
}

/**
 * Mark-level checks: each fixture is a stored scenegraph handed straight to the
 * renderer, with no View, no dataflow and no layout in between. The canvas
 * renderer is the ground truth, same as the spec suite.
 */
test.describe('scenes', () => {
  for (const name of renderScenes) {
    test(name, async ({ page }, testInfo: TestInfo) => {
      test.skip(name in skippedScenes, skippedScenes[name]);
      const diff = Object.hasOwn(sceneCheckOverrides, name) ? sceneCheckOverrides[name] : SCENE_CHECK_DEFAULT;
      await compareCase(testInfo, {
        name,
        kind: 'fixture',
        file: `scene-${name}`,
        label: `scene:${name}`,
        note: sceneNote(name),
        render: (renderer: RendererName) => renderScene(page, name, renderer),
        budgets: {
          diff,
          tile: TILE_CHECK_DEFAULT,
          mean: sceneMeanDeltaOverrides[name] ?? SCENE_MEAN_DELTA_DEFAULT,
          bias: sceneBiasDeltaOverrides[name] ?? SCENE_BIAS_DELTA_DEFAULT,
          flat: sceneFlatMeanOverrides[name] ?? SCENE_FLAT_MEAN_DEFAULT,
          // A fixture is small synthetic geometry, so a local measure means
          // something here in a way it does not on a full spec.
          quad: quadDeltaOverrides[name] ?? QUAD_DELTA_DEFAULT,
        },
      });
    });
  }
});
