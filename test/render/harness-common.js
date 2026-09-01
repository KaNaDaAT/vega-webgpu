/**
 * Shared plumbing for the two render harnesses: error capture, identifying
 * which renderer actually ran, and reading the finished canvas.
 * Used by harness.js (full specs) and scene-harness.js (scenegraph fixtures).
 */
// Errors vega catches and logs carry no stack by the time they reach the
// console, so record them here for the test to report.
window.__traces = [];

function recordTrace(label, err) {
  const stack = (err && err.stack) || String(err);
  window.__traces.push(`${label}: ${stack}`);
}

window.addEventListener('error', e => recordTrace('window.onerror', e.error ?? e.message));
window.addEventListener('unhandledrejection', e => recordTrace('unhandledrejection', e.reason));

/**
 * Identifies a renderer by capability, not class name: vega's minified bundle
 * mangles class names. The WebGPU renderer exposes wgOptions plus a live
 * device(); the canvas renderer hands out a real 2D context.
 */
function rendererKind(r) {
  if (!r) {
    return 'none';
  }
  if (r.wgOptions && typeof r.device === 'function' && r.device()) {
    return 'webgpu';
  }
  if (typeof r.canvas === 'function' && r.canvas() && r.canvas().getContext('2d')) {
    return 'canvas';
  }
  return r.constructor?.name || 'other';
}

/**
 * Publishes window.__snapshot. Reads the GPU texture directly where it can: a
 * headless runner never composites, so both element screenshots and toDataURL
 * come back blank there. The canvas renderer has no such path and uses
 * toDataURL.
 */
function installSnapshot(r, kind) {
  window.__snapshot = async () => {
    const el = document.querySelector('#vis canvas');
    if (!el) return null;
    if (kind === 'webgpu' && r && typeof r.captureFrame === 'function') {
      let shot;
      try {
        shot = await r.captureFrame();
      } catch (err) {
        // Fall back rather than hang the test. toDataURL is blank without a
        // compositor, which the pixel diff will show, and the reason lands in
        // the failure output instead of a bare timeout.
        recordTrace('captureFrame failed', err);
        return { dataUrl: el.toDataURL('image/png') };
      }
      // base64 rather than a plain array: serializing a few million numbers
      // as JSON across the debugging protocol dwarfs the render itself.
      let binary = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < shot.data.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, shot.data.subarray(i, i + CHUNK));
      }
      return { rawB64: btoa(binary), width: shot.width, height: shot.height };
    }
    return { dataUrl: el.toDataURL('image/png') };
  };
}

/**
 * Applies the options every test render needs. Acquiring the canvas swapchain
 * destroys the device on a runner with no compositor, and tests read the frame
 * back off the GPU anyway, so nothing here ever needs it. Both harnesses go
 * through this so they cannot drift apart.
 */
function applyTestOptions(renderer, params) {
  const options = renderer?.wgOptions;
  if (!options) {
    return;
  }
  options.offscreen = true;
  const sampleCount = params?.get('sampleCount');
  if (sampleCount) {
    options.sampleCount = Number(sampleCount);
  }
}
