/** WGSL shader sources are inlined as strings by rollup-plugin-string. */
declare module '*.wgsl' {
  const wgsl: string;
  export default wgsl;
}
