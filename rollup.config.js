import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';

// Externals provided by the `vega` browser bundle when loaded via <script>.
const vegaExternals = ['vega-scenegraph'];
const vegaGlobals = {
  'vega-scenegraph': 'vega',
};

/**
 * Strips comments and collapses whitespace inside the template literals of the
 * shader modules. WGSL is written with the same care as the TypeScript around
 * it, and terser will not touch a template literal's text, so the source
 * comments ship verbatim: about 30 KB of the minified bundle, a fifth of it.
 *
 * Only the text spans of a template literal are touched. Interpolations are
 * copied through untouched, and whitespace collapses to a single space rather
 * than vanishing, so tokens stay separated.
 */
const minifyWgsl = () => ({
  name: 'minify-wgsl',
  transform(code, id) {
    if (!/src[\\/]shaders[\\/].*\.ts$/.test(id)) {
      return null;
    }
    const squeeze = text =>
      text
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/.*/g, '')
        .replace(/\s+/g, ' ');

    let out = '';
    let i = 0;
    // depth of ${ } we are inside, so a nested template is handled too
    const stack = [];
    let text = null;
    while (i < code.length) {
      const c = code[i];
      if (text !== null) {
        if (c === '\\') {
          text += code.slice(i, i + 2);
          i += 2;
          continue;
        }
        if (c === '`') {
          out += squeeze(text) + '`';
          text = null;
          i++;
          stack.pop();
          continue;
        }
        if (c === '$' && code[i + 1] === '{') {
          out += squeeze(text) + '${';
          text = null;
          stack.push('expr');
          i += 2;
          continue;
        }
        text += c;
        i++;
        continue;
      }
      if (c === '`') {
        out += '`';
        text = '';
        stack.push('tpl');
        i++;
        continue;
      }
      if (c === '}' && stack[stack.length - 1] === 'expr') {
        stack.pop();
        out += '}';
        text = '';
        i++;
        continue;
      }
      out += c;
      i++;
    }
    return { code: out, map: { mappings: '' } };
  },
});

const plugins = () => [
  minifyWgsl(),
  commonjs(),
  resolve({ browser: true }),
  typescript({
    tsconfig: './tsconfig.json',
    noEmit: false,
    outputToFilesystem: true,
  }),
];

export default [
  // UMD builds for <script> usage: bundles d3-color and the path/geometry
  // helpers so only vega itself is required on the page.
  {
    input: 'index.ts',
    external: vegaExternals,
    output: [
      {
        file: 'build/vega-webgpu-renderer.js',
        format: 'umd',
        name: 'vegaWebGPURenderer',
        sourcemap: true,
        globals: vegaGlobals,
      },
      {
        file: 'build/vega-webgpu-renderer.min.js',
        format: 'umd',
        name: 'vegaWebGPURenderer',
        sourcemap: true,
        globals: vegaGlobals,
        plugins: [terser()],
      },
    ],
    plugins: plugins(),
  },
  // ESM build for bundlers: all dependencies stay external.
  {
    input: 'index.ts',
    external: [
      ...vegaExternals,
      'd3-color',
      'extrude-polyline',
      'parse-svg-path',
      'simplify-path',
      'svg-path-contours',
      'triangulate-contours',
    ],
    output: {
      file: 'build/vega-webgpu-renderer.module.js',
      format: 'esm',
      sourcemap: true,
    },
    plugins: plugins(),
  },
];
