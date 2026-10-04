/** The repository root. */
export const root: string;

/** Where a render suite run with RENDER_ARTIFACTS=1 leaves its pngs and manifest. */
export const outputDir: string;

/** The manifest of that run, which the gallery reads. */
export const manifestPath: string;

/** The manifest the last run wrote, or null when there is none. */
export function readManifest(): { cases: Record<string, unknown>[]; [key: string]: unknown } | null;
