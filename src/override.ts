import { App, TAbstractFile, TFolder } from "obsidian";
import { AttachmentManagementPluginSettings, AttachmentPathSettings, SETTINGS_TYPES } from "./settings/settings";
import { debugLog } from "./lib/log";
import { info, trace, warn } from "./lib/logger";
import { stripPaths } from "./utils";

/**
 * List override keys whose path no longer exists in the vault. Such keys can never
 * be matched again (matching is by exact path or path prefix), so the override they
 * carry is silently dead and its former target falls back to the global setting.
 */
export function auditOverrideKeys(
  app: App,
  settings: AttachmentManagementPluginSettings,
): { total: number; stale: string[] } {
  const keys = Object.keys(settings.overridePath);
  const stale = keys.filter((key) => app.vault.getAbstractFileByPath(key) === null);
  return { total: keys.length, stale: stale };
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
 * Return the best matched override settings for the file/folder on rename event.
 * We need this function to process the use case below:
 *  suppose you have override settings of a folder, and when your rename the folder,
 *  the override setting of oldPath may be updated and will not to be found
 *  in rename event that trigger by subpath of oldPath.
 * @param settings plugin setting
 * @param file file need to get setting
 * @param oldPath old path of the file, it it's be renamed (option)
 * @returns { settingPath: string; setting: AttachmentPathSettings }, the best matched setting,
 * where settingPath is the relate path of this setting, it should be same with input path or is the
 * subpath of the settingPath.
 */
export function getRenameOverrideSetting(
  settings: AttachmentManagementPluginSettings,
  file: TAbstractFile,
  oldPath: string,
): { settingPath: string; setting: AttachmentPathSettings } {
  const resolved = resolveRenameOverrideSetting(settings, file, oldPath);
  info("res:override", "rename override resolved", {
    newPath: file.path,
    oldPath: oldPath,
    settingPath: resolved.settingPath,
    settingType: resolved.setting.type,
  });
  return resolved;
}

function resolveRenameOverrideSetting(
  settings: AttachmentManagementPluginSettings,
  file: TAbstractFile,
  oldPath: string,
): { settingPath: string; setting: AttachmentPathSettings } {
  if (Object.keys(settings.overridePath).length === 0) {
    return { settingPath: "", setting: settings.attachPath };
  }

  const { settingPath: np, setting: ns } = getOverrideSetting(settings, file);
  const { settingPath: op, setting: os } = getOverrideSetting(settings, file, oldPath);

  if (ns.type === SETTINGS_TYPES.GLOBAL) {
    return { settingPath: op, setting: os };
  }

  if (os.type === SETTINGS_TYPES.GLOBAL) {
    return { settingPath: np, setting: ns };
  }

  if (ns.type === SETTINGS_TYPES.FILE && os.type === SETTINGS_TYPES.FILE) {
    // This should not happen
    debugLog("getRenameOverrideSetting - both file type setting", np, op);
    return { settingPath: "", setting: settings.attachPath };
  }

  if (ns.type === SETTINGS_TYPES.FILE && os.type === SETTINGS_TYPES.FOLDER) {
    return { settingPath: np, setting: ns };
  } else if (ns.type === SETTINGS_TYPES.FOLDER && os.type === SETTINGS_TYPES.FILE) {
    return { settingPath: op, setting: os };
  }

  if (ns.type === SETTINGS_TYPES.FOLDER && os.type === SETTINGS_TYPES.FOLDER) {
    const l = np.split("/").length;
    const r = op.split("/").length;

    if (l > r) {
      return { settingPath: np, setting: ns };
    } else if (l < r) {
      return { settingPath: op, setting: os };
    } else if (l === r) {
      if (np !== op) {
        // The caller re-keys `overridePath` using `settingPath`, so returning an empty
        // path here leaves the old key behind and the override stops matching.
        warn("res:override", "cascade rename with same-depth overrides", {
          newPath: file.path,
          oldPath: oldPath,
          newSettingPath: np,
          oldSettingPath: op,
          reason: "same_depth_different_key",
        });
      }
      // same case, np == op, return any one
      return { settingPath: "", setting: os };
    }
  }

  return { settingPath: "", setting: settings.attachPath };
}

/**
 * Update the override setting of the renamed file
 * @param settings plugin setting
 * @param file renamed file
 * @param oldPath old path of the renamed file
 * @returns
 */
export function updateOverrideSetting(
  settings: AttachmentManagementPluginSettings,
  file: TAbstractFile,
  oldPath: string,
) {
  const keys = Object.keys(settings.overridePath);
  if (keys.length === 0 || file.path === oldPath) {
    return;
  }

  const { settingPath, setting } = getOverrideSetting(settings, file, oldPath);
  const copySetting = Object.assign({}, setting);

  // if the file was overridden, skip
  if (file.path === settingPath) {
    return;
  }

  if (oldPath === settingPath) {
    settings.overridePath[file.path] = copySetting;
    delete settings.overridePath[settingPath];
    info("res:override", "override key re-keyed on rename", {
      oldKey: settingPath,
      newKey: file.path,
      type: copySetting.type,
    });
    return;
  } else {
    const { stripedSrc, stripedDst } = stripPaths(oldPath, file.path);
    if (stripedSrc === settingPath) {
      settings.overridePath[stripedDst] = copySetting;
      delete settings.overridePath[settingPath];
      info("res:override", "override key re-keyed on cascade rename", {
        oldKey: settingPath,
        newKey: stripedDst,
        type: copySetting.type,
      });
      return;
    }
  }
}

export function deleteOverrideSetting(settings: AttachmentManagementPluginSettings, file: TAbstractFile): boolean {
  const keys = Object.keys(settings.overridePath);
  const descendants = keys.filter((key) => key.startsWith(file.path + "/"));
  for (const key of keys) {
    if (file.path === key) {
      delete settings.overridePath[key];
      if (descendants.length > 0) {
        // Only the exact key is removed. Descendant keys survive and will resurrect
        // their old setting if a note is later recreated at the same path.
        warn("res:override", "descendant override keys left behind", {
          path: file.path,
          descendants: descendants,
          reason: "descendant_keys_not_cleaned",
        });
      }
      return true;
    }
  }
  return false;
}
