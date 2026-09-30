import { normalizePath } from "obsidian";

/**
 * Paths this plugin writes itself — a rearrange split's copies and the moved original.
 * Obsidian fires `create` from its file watcher for anything that appears on disk,
 * including our own writes (the `Vault` methods only delegate to the adapter). Without
 * this registry a fresh copy would pass the paste-window filter, be enqueued, and then
 * be renamed again by `processAttach`.
 */
const PROGRAMMATIC_WRITE_TTL_MS = 10_000;
const pending = new Map<string, number>();

export function markProgrammaticWrite(path: string): void {
  const now = Date.now();
  for (const [key, expiry] of pending.entries()) {
    if (expiry < now) {
      pending.delete(key);
    }
  }
  pending.set(normalizePath(path), now + PROGRAMMATIC_WRITE_TTL_MS);
}

/** True for the first event carrying a registered path; the entry is then consumed. */
export function consumeProgrammaticWrite(path: string): boolean {
  const key = normalizePath(path);
  const expiry = pending.get(key);
  if (expiry === undefined || expiry < Date.now()) {
    return false;
  }
  pending.delete(key);
  return true;
}
