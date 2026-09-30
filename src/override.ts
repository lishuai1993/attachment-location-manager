import { App, TAbstractFile, TFile, TFolder } from "obsidian";
import { AttachmentManagementPluginSettings, AttachmentPathSettings, SETTINGS_TYPES } from "./settings/settings";
import { debugLog } from "./lib/log";
import { info, trace, warn } from "./lib/logger";

export interface OverrideKeyAudit {
  total: number;
  /** The vault has nothing at the key's path. */
  stale: string[];
  /** The vault has something at the key's path, but not the kind the key is stored as. */
  mismatched: string[];
}

/**
 * List override keys that can never match again. Matching is by exact path (file
 * override) or path prefix (folder override), and a match additionally requires the
 * stored `type` to agree with what is at that path, so both a vanished path and a
 * type that no longer fits leave the override silently dead and its former target
 * falling back to the global setting.
 */
export function auditOverrideKeys(app: App, settings: AttachmentManagementPluginSettings): OverrideKeyAudit {
  const keys = Object.keys(settings.overridePath);
  const stale: string[] = [];
  const mismatched: string[] = [];
  for (const key of keys) {
    const target = app.vault.getAbstractFileByPath(key);
    if (target === null) {
      stale.push(key);
      continue;
    }
    const storedType = settings.overridePath[key].type;
    if (
      (storedType === SETTINGS_TYPES.FILE && !(target instanceof TFile)) ||
      (storedType === SETTINGS_TYPES.FOLDER && !(target instanceof TFolder))
    ) {
      mismatched.push(key);
    }
  }
  return { total: keys.length, stale: stale, mismatched: mismatched };
}

/**
 * Return the best matched override settings for the file/folder
 * @param settings plugin setting
 * @param file file need to get setting
 * @param oldPath old path of the file, it it's be renamed (option)
 * @returns { settingPath: string; setting: AttachmentPathSettings }, the best matched setting,
 * where settingPath is the relate path of this setting, it should be same with input path or is the
 * subpath of the settingPath.
 */
export function getOverrideSetting(
  settings: AttachmentManagementPluginSettings,
  file: TAbstractFile,
  oldPath = "",
): { settingPath: string; setting: AttachmentPathSettings } {
  if (Object.keys(settings.overridePath).length === 0) {
    trace("res:override", "no override configured", { filePath: file.path, reason: "no_override_configured" });
    return { settingPath: "", setting: settings.attachPath };
  }

  const candidates: Record<string, AttachmentPathSettings> = {};
  const fileType: boolean = !(file instanceof TFolder);
  const filePath = oldPath === "" ? file.path : oldPath;
  // Keys related to this target whose stored type forbids a match. They silently
  // lose their override, so they are collected and reported at WARN.
  const typeMismatch: string[] = [];
  const expectedType = fileType ? SETTINGS_TYPES.FILE : SETTINGS_TYPES.FOLDER;

  for (const overridePath of Object.keys(settings.overridePath)) {
    const overrideSetting = settings.overridePath[overridePath];
    const isAncestor = filePath.startsWith(overridePath) && filePath.charAt(overridePath.length) === "/";
    if (fileType) {
      if (overridePath === filePath && overrideSetting.type === SETTINGS_TYPES.FILE) {
        // best match
        info("res:override", "resolved to file override", {
          filePath: filePath,
          settingPath: overridePath,
          saveAttE: overrideSetting.saveAttE,
          attachmentRoot: overrideSetting.attachmentRoot,
          attachmentPath: overrideSetting.attachmentPath,
          attachFormat: overrideSetting.attachFormat,
        });
        return { settingPath: overridePath, setting: overrideSetting };
      } else if (isAncestor && overrideSetting.type === SETTINGS_TYPES.FOLDER) {
        // parent path
        candidates[overridePath] = overrideSetting;
      }
    } else {
      if (overridePath === filePath && overrideSetting.type === SETTINGS_TYPES.FOLDER) {
        // best match
        info("res:override", "resolved to folder override", {
          filePath: filePath,
          settingPath: overridePath,
          saveAttE: overrideSetting.saveAttE,
          attachmentRoot: overrideSetting.attachmentRoot,
          attachmentPath: overrideSetting.attachmentPath,
          attachFormat: overrideSetting.attachFormat,
        });
        return { settingPath: overridePath, setting: overrideSetting };
      } else if (isAncestor && overrideSetting.type === SETTINGS_TYPES.FOLDER) {
        // parent path
        candidates[overridePath] = overrideSetting;
      }
    }

    if (
      overridePath === filePath
        ? overrideSetting.type !== expectedType
        : isAncestor && overrideSetting.type === SETTINGS_TYPES.FILE
    ) {
      typeMismatch.push(overridePath);
    }
  }

  if (typeMismatch.length > 0) {
    warn("res:override", "override key type mismatch, target falls back", {
      filePath: filePath,
      target: fileType ? "file" : "folder",
      mismatchedKeys: typeMismatch,
      reason: "override_type_mismatch",
    });
  }

  if (Object.keys(candidates).length === 0) {
    // Overrides are configured but none matched this target, so it silently falls back
    // to the global setting. This is the decisive evidence for "the override I set is
    // being ignored". Only reached when `overridePath` is non-empty (the
    // no-overrides-configured case returns earlier), so it cannot flood a vault that
    // does not use overrides at all.
    warn("res:override", "fallback to global", {
      filePath: filePath,
      keyCount: Object.keys(settings.overridePath).length,
      keys: Object.keys(settings.overridePath),
      reason: "override_miss",
    });
    return { settingPath: "", setting: settings.attachPath };
  }

  // sort by splitted path length, descending
  const sortedK = Object.keys(candidates).sort((a, b) =>
    a.split("/").length > b.split("/").length ? -1 : a.split("/").length < b.split("/").length ? 1 : 0,
  );
  debugLog("getOverrideSetting - sortedK:", sortedK);
  for (const k of sortedK) {
    if (filePath.startsWith(k)) {
      const ancestorSetting = candidates[k];
      info("res:override", "resolved to ancestor folder override", {
        filePath: filePath,
        settingPath: k,
        saveAttE: ancestorSetting.saveAttE,
        attachmentRoot: ancestorSetting.attachmentRoot,
        attachmentPath: ancestorSetting.attachmentPath,
        attachFormat: ancestorSetting.attachFormat,
      });
      return { settingPath: k, setting: ancestorSetting };
    }
  }

  warn("res:override", "fallback to global", {
    filePath: filePath,
    keyCount: Object.keys(settings.overridePath).length,
    keys: Object.keys(settings.overridePath),
    reason: "no_candidate",
  });
  return { settingPath: "", setting: settings.attachPath };
}

/**
 * Re-key every override whose path is the renamed target or sits under it.
 *
 * A key's path is its only identity, so a rename must carry the key with its target.
 * Doing it by prefix makes the move idempotent and order-independent: Obsidian emits
 * one `rename` event per descendant, and whichever arrives first performs the whole
 * move while the rest find nothing left to move.
 *
 * @returns the keys actually re-keyed, so the caller can persist and report the change
 */
export function updateOverrideSetting(
  settings: AttachmentManagementPluginSettings,
  file: TAbstractFile,
  oldPath: string,
): { moved: { oldKey: string; newKey: string }[] } {
  const moved: { oldKey: string; newKey: string }[] = [];
  if (oldPath === file.path) {
    return { moved: moved };
  }

  const prefix = oldPath + "/";
  for (const key of Object.keys(settings.overridePath)) {
    if (key === oldPath) {
      moved.push({ oldKey: key, newKey: file.path });
    } else if (key.startsWith(prefix)) {
      moved.push({ oldKey: key, newKey: file.path + key.slice(oldPath.length) });
    }
  }

  for (const { oldKey, newKey } of moved) {
    settings.overridePath[newKey] = settings.overridePath[oldKey];
    delete settings.overridePath[oldKey];
  }
  return { moved: moved };
}

/**
 * Remove the override of the deleted target together with every override keyed under
 * it. Deleting a folder must take its descendants' overrides with it: a key left
 * behind at a path that no longer exists is dead (matching is by exact path or path
 * prefix), and if a note is later recreated at that same path the stale key silently
 * resurrects the old setting.
 *
 * @returns the keys actually removed, so the caller can persist and report the change
 */
export function deleteOverrideSetting(
  settings: AttachmentManagementPluginSettings,
  file: TAbstractFile,
): { removed: string[] } {
  const removed: string[] = [];
  const prefix = file.path + "/";
  for (const key of Object.keys(settings.overridePath)) {
    if (key === file.path || key.startsWith(prefix)) {
      removed.push(key);
      delete settings.overridePath[key];
    }
  }
  return { removed: removed };
}
