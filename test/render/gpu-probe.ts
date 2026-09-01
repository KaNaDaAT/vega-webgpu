/**
 * Records the WebGPU lifecycle from inside the page: when an adapter and device
 * are handed out, when a device is lost, and whether destroy() was called from
 * JS at all. A loss with reason 'destroyed' is either destroy() or the browser
 * dropping the device, and only a stack tells the two apart.
 */
export function gpuProbe(): void {
  const w = window as unknown as { __gpuLog?: string[] };
  const log: string[] = (w.__gpuLog = []);
  const t0 = performance.now();
  const at = (msg: string) => log.push(`${(performance.now() - t0).toFixed(0)}ms ${msg}`);
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    at('navigator.gpu missing');
    return;
  }
  const gpu = navigator.gpu;
  const requestAdapter = gpu.requestAdapter.bind(gpu);
  gpu.requestAdapter = async options => {
    const adapter = await requestAdapter(options);
    at(`requestAdapter -> ${adapter ? 'adapter' : 'null'}`);
    return adapter;
  };
  const proto = (globalThis as unknown as { GPUAdapter?: { prototype: GPUAdapter } }).GPUAdapter?.prototype;
  if (!proto) {
    at('GPUAdapter missing');
    return;
  }
  const requestDevice = proto.requestDevice;
  proto.requestDevice = async function (this: GPUAdapter, descriptor?: GPUDeviceDescriptor) {
    const device = await requestDevice.call(this, descriptor);
    at('requestDevice -> device');
    device.lost.then(info => at(`lost: ${info.reason} ${info.message}`));
    const destroy = device.destroy.bind(device);
    device.destroy = () => {
      at(`destroy() from JS:\n${new Error().stack}`);
      destroy();
    };
    return device;
  };
}

export interface ProbeTarget {
  addInitScript(script: () => void): Promise<unknown>;
}

/** Installs the probe before any page script runs. */
export async function installGpuProbe(target: ProbeTarget): Promise<void> {
  await target.addInitScript(gpuProbe);
}
