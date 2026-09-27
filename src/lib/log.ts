import { LogLevel, log } from "./logger";

/**
 * Legacy dev-only logger, kept as a thin alias while call sites migrate to the
 * leveled API in `logger.ts`. Emits at TRACE level under the `sys:legacy` tag.
 */
export function debugLog(...args: unknown[]): void {
  log(LogLevel.TRACE, "sys:legacy", formatLegacyArgs(args));
}

function formatLegacyArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") {
        return arg;
      }
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}
