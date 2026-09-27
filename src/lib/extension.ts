import { AttachmentPathSettings, ExtensionOverrideSettings } from "../settings/settings";
import { matchExtension } from "../utils";
import { debugLog } from "./log";

/**
 * Retrieves the exception entry for a specific extension.
 *
 * @param {string} extension - The extension to retrieve the exception for.
 * @param {AttachmentPathSettings} settings - The settings of the layer that owns the exception list.
 * @return {{ extSetting: ExtensionOverrideSettings | undefined }} - the first entry whose pattern matches.
 */
export function getExtensionOverrideSetting(
  extension: string,
  settings: AttachmentPathSettings,
): { extSetting: ExtensionOverrideSettings | undefined } {
  if (settings.extensionOverride === undefined || settings.extensionOverride.length === 0) {
    return { extSetting: undefined };
  }

  for (let i = 0; i < settings.extensionOverride.length; i++) {
    if (matchExtension(extension, settings.extensionOverride[i].extension)) {
      debugLog(
        "getExtensionOverrideSetting - ",
        settings.extensionOverride[i].extension,
        settings.extensionOverride[i],
      );
      return { extSetting: settings.extensionOverride[i] };
    }
  }

  return { extSetting: undefined };
}

/**
 * The four fields an exception entry can carry, after inheritance is applied.
 * Every field is a plain string here, so downstream code reads them unconditionally.
 */
export interface ResolvedExtensionFields {
  saveAttE: string;
  attachmentRoot: string;
  attachmentPath: string;
  attachFormat: string;
}

/**
 * Apply an exception entry on top of its owning layer.
 *
 * An exception is a delta, not a replacement: a field is taken from the entry only
 * when the entry carries it, otherwise it follows the layer. `??` (not `||`) is what
 * makes an explicitly empty `attachmentRoot` distinguishable from an absent one.
 */
export function resolveExtensionFields(
  layer: AttachmentPathSettings,
  ext: ExtensionOverrideSettings,
): ResolvedExtensionFields {
  return {
    saveAttE: ext.saveAttE ?? layer.saveAttE,
    attachmentRoot: ext.attachmentRoot ?? layer.attachmentRoot,
    attachmentPath: ext.attachmentPath ?? layer.attachmentPath,
    attachFormat: ext.attachFormat ?? layer.attachFormat,
  };
}
