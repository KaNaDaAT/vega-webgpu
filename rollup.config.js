import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import { string } from 'rollup-plugin-string';

// Externals provided by the `vega` browser bundle when loaded via <script>.
const vegaExternals = ['vega-scenegraph'];
const vegaGlobals = {
  'vega-scenegraph': 'vega',
};

const plugins = () => [
  commonjs(),
  resolve({ browser: true }),
  string({ include: '**/*.wgsl' }),
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
