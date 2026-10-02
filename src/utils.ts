import { App, DataAdapter, Notice, TAbstractFile, TFile } from "obsidian";
import { AttachmentManagementPluginSettings, AttachmentPathSettings } from "./settings/settings";
import { t } from "./i18n/index";
import {
  SETTINGS_VARIABLES_DATES,
  SETTINGS_VARIABLES_NOTENAME,
  SETTINGS_VARIABLES_NOTEPARENT,
  SETTINGS_VARIABLES_NOTEPATH,
  SETTINGS_VARIABLES_MD5,
  SETTINGS_VARIABLES_ORIGINALNAME,
} from "./lib/constant";

import { Md5 } from "ts-md5";

export const blobToArrayBuffer = (blob: Blob) => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsArrayBuffer(blob);
  });
};

export function isMarkdownFile(extension: string): boolean {
  return extension === "md";
}

export function isCanvasFile(extension: string): boolean {
  return extension === "canvas";
}

/**
 * Test whether the object is a file that is not a note. Folders and note files
 * (markdown, canvas) are not, so this splits the vault into "note or folder" and
 * "candidate attachment".
 */
export function isNonNoteFile(file: TAbstractFile | null): boolean {
  return file instanceof TFile && !isMarkdownFile(file.extension) && !isCanvasFile(file.extension);
}

/**
 * Test if the extension is matched by pattern. Case-insensitive: Obsidian lowercases
 * `TFile.extension`, but the pattern is typed by the user and may not be.
 * @param extension extension of a file
 * @param pattern patterns for match extension
 * @returns true if matched, false otherwise
 */
export function matchExtension(extension: string, pattern: string): boolean {
  if (!pattern || pattern === "") return false;
  return new RegExp(pattern, "i").test(extension);
}

/**
 * Check whether the file is managed as an attachment: any file that is not a note
 * and whose extension is not excluded. This is the single definition of the
 * attachment range; call sites that only need "not a note" should use
 * {@link isNonNoteFile} instead, or an excluded file would be mistaken for a note.
 * @param settings plugins configuration
 * @param filePath file path
 * @returns true if the file is an attachment, false otherwise
 */
export function isAttachment(
  app: App,
  settings: AttachmentManagementPluginSettings,
  filePath: string | TAbstractFile,
): boolean {
  const file = filePath instanceof TAbstractFile ? filePath : app.vault.getAbstractFileByPath(filePath);

  if (file === null || !(file instanceof TFile) || !isNonNoteFile(file)) {
    return false;
  }

  return !matchExtension(file.extension, settings.excludeExtensionPattern);
}

export function getParentFolder(rf: TFile) {
  const parent = rf.parent;
  let parentPath = "/";
  let parentName = "/";
  if (parent) {
    parentPath = parent.path;
    parentName = parent.name;
  }
  return { parentPath, parentName };
}

export async function md5sum(adapter: DataAdapter, file: TFile): Promise<string> {
  const md5 = new Md5();

  if (!(await adapter.exists(file.path, true))) {
    return "";
  }

  const content = await adapter.readBinary(file.path);
  md5.appendByteArray(new Uint8Array(content));
  const ret = md5.end() as string;

  return ret.toUpperCase();
}

export function validateExtensionEntry(setting: AttachmentPathSettings, plugin: AttachmentManagementPluginSettings) {
  const wrongIndex: {
    type: "empty" | "duplicate" | "md" | "canvas" | "excluded";
    index: number;
  }[] = [];
  if (setting.extensionOverride !== undefined) {
    const extOverride = setting.extensionOverride;
    if (extOverride.some((ext) => ext.extension === "")) {
      wrongIndex.push({ type: "empty", index: extOverride.findIndex((ext) => ext.extension === "") });
    }
    // These three compare case-insensitively too: patterns are matched with the `i` flag,
    // so `PDF` and `pdf` are the same extension to the runtime, and the second of the pair
    // is a dead entry that must not pass silently.
    const lowered = extOverride.map((ext) => ext.extension.toLowerCase());
    lowered.forEach((value, index) => {
      // First match wins, so the earliest entry carrying an extension is the live one and
      // every later one is dead. Flag the dead ones: flagging the first instead would let a
      // just-typed duplicate pass and reach `data.json`.
      if (lowered.indexOf(value) !== index) {
        wrongIndex.push({ type: "duplicate", index });
      }
    });
    const mdIndex = lowered.indexOf("md");
    if (mdIndex >= 0) {
      wrongIndex.push({ type: "md", index: mdIndex });
    }
    const canvasIndex = lowered.indexOf("canvas");
    if (canvasIndex >= 0) {
      wrongIndex.push({ type: "canvas", index: canvasIndex });
    }
    // Same engine as the runtime gate. A literal comparison against split("|") would
    // let a pattern like `docx?` slip a never-firing exception past validation.
    const excludedIndex = extOverride.findIndex((ext) => matchExtension(ext.extension, plugin.excludeExtensionPattern));
    if (excludedIndex >= 0) {
      wrongIndex.push({ type: "excluded", index: excludedIndex });
    }
  }
  return wrongIndex;
}

export function generateErrorExtensionMessage(type: "md" | "canvas" | "empty" | "duplicate" | "excluded") {
  if (type === "canvas") {
    new Notice(t("errors.canvasNotSupported"));
  } else if (type === "md") {
    new Notice(t("errors.markdownNotSupported"));
  } else if (type === "empty") {
    new Notice(t("errors.extensionEmpty"));
  } else if (type === "duplicate") {
    new Notice(t("errors.duplicateExtension"));
  } else if (type === "excluded") {
    new Notice(t("errors.excludedExtension"));
  }
}

const ALLOWED_FORMAT_VARS = [
  SETTINGS_VARIABLES_DATES,
  SETTINGS_VARIABLES_NOTENAME,
  SETTINGS_VARIABLES_MD5,
  SETTINGS_VARIABLES_ORIGINALNAME,
];
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|]/;
const VAR_TOKEN_RE = /\$\{[^}]+\}/g;

export type AttachFormatError =
  | { type: "empty" }
  | { type: "illegalChar"; char: string }
  | { type: "unknownVariable"; name: string };

export function validateAttachFormat(value: string): AttachFormatError | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return { type: "empty" };

  const stripped = trimmed.replace(VAR_TOKEN_RE, "");
  const bad = stripped.match(ILLEGAL_FILENAME_CHARS);
  if (bad) return { type: "illegalChar", char: bad[0] };

  const vars = trimmed.match(VAR_TOKEN_RE) ?? [];
  for (const v of vars) {
    if (!ALLOWED_FORMAT_VARS.includes(v)) {
      return { type: "unknownVariable", name: v };
    }
  }
  return null;
}

export function attachFormatErrorMessage(err: AttachFormatError): string {
  switch (err.type) {
    case "empty":
      return t("errors.attachFormatEmpty");
    case "illegalChar":
      return t("errors.attachFormatIllegalChar", { char: err.char });
    case "unknownVariable":
      return t("errors.attachFormatUnknownVariable", { name: err.name });
  }
}

const ALLOWED_PATH_VARS = [SETTINGS_VARIABLES_NOTEPATH, SETTINGS_VARIABLES_NOTENAME, SETTINGS_VARIABLES_NOTEPARENT];
// "/" is allowed because attachmentPath is a path, not a filename.
const ILLEGAL_PATH_CHARS = /[\\:*?"<>|]/;

export type AttachmentPathError =
  | { type: "empty" }
  | { type: "illegalChar"; char: string }
  | { type: "unknownVariable"; name: string };

export function validateAttachmentPath(value: string): AttachmentPathError | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return { type: "empty" };

  const stripped = trimmed.replace(VAR_TOKEN_RE, "");
  const bad = stripped.match(ILLEGAL_PATH_CHARS);
  if (bad) return { type: "illegalChar", char: bad[0] };

  const vars = trimmed.match(VAR_TOKEN_RE) ?? [];
  for (const v of vars) {
    if (!ALLOWED_PATH_VARS.includes(v)) {
      return { type: "unknownVariable", name: v };
    }
  }
  return null;
}

export function attachmentPathErrorMessage(err: AttachmentPathError): string {
  switch (err.type) {
    case "empty":
      return t("errors.attachmentPathEmpty");
    case "illegalChar":
      return t("errors.attachmentPathIllegalChar", { char: err.char });
    case "unknownVariable":
      return t("errors.attachmentPathUnknownVariable", { name: err.name });
  }
}
