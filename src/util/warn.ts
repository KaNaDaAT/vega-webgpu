const warned = new Set<string>();

/** Warns once per page for each key, since most of these would fire every frame. */
export function warnOnce(key: string, message: string): void {
  if (!warned.has(key)) {
    warned.add(key);
    console.warn(message);
  }
}
