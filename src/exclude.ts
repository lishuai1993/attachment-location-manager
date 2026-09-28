import { debugLog } from "./lib/log";
import { AttachmentManagementPluginSettings } from "./settings/settings";

export function isExcluded(path: string, settings: AttachmentManagementPluginSettings): boolean {
  debugLog("excludePathsArray: ", settings.excludePathsArray);

  for (const excludedPath of settings.excludePathsArray) {
    if (excludedPath.length === 0) {
      continue;
    }
    // Trailing slashes are stripped so that "Notes/" still means the folder "Notes".
    const base = excludedPath.replace(/\/+$/, "");
    // Sub-path match requires a path-segment boundary, so "Notes" does not also
    // swallow its siblings such as "Notes-old".
    if (path === base || (settings.excludeSubpaths && path.startsWith(base + "/"))) {
      debugLog("isExcluded: ", path);
      return true;
    }
  }

  return false;
}
