import { App, Plugin, Notice, TFile, TFolder, debounce, normalizePath, MarkdownView } from "obsidian";
import { deduplicateNewName } from "./lib/deduplicate";
import { path } from "./lib/path";
import { debugLog } from "./lib/log";
import { error, info, trace, warn } from "./lib/logger";
import { AttachmentManagementPluginSettings } from "./settings/settings";
import { getOverrideSetting } from "./override";
import { getMetadata } from "./settings/metadata";
import { isExcluded } from "./exclude";
import { getExtensionOverrideSetting } from "./lib/extension";
import { md5sum } from "./utils";
import { saveOriginalName } from "./lib/originalStorage";
import { planLinkRewrite } from "./lib/embed";
import { t } from "./i18n/index";

// Batch rename notices so rapid renames (e.g. paste bursts, rearrange-driven
// rename cascades) collapse into a single Notice instead of flooding the UI.
type RenameRecord = { from: string; to: string };
const pendingRenameNotices: RenameRecord[] = [];

const flushRenameNotices = debounce(
  () => {
    if (pendingRenameNotices.length === 0) {
      return;
    }
    if (pendingRenameNotices.length === 1) {
      const { from, to } = pendingRenameNotices[0];
      new Notice(t("notices.fileRenamed", { from, to }));
    } else {
      new Notice(t("notices.filesRenamedBatch", { count: pendingRenameNotices.length }));
    }
    pendingRenameNotices.length = 0;
  },
  500,
  true,
);

function queueRenameNotice(from: string, to: string) {
  pendingRenameNotices.push({ from, to });
  flushRenameNotices();
}

export class CreateHandler {
  readonly plugin: Plugin;
  readonly app: App;
  readonly settings: AttachmentManagementPluginSettings;

  constructor(plugin: Plugin, settings: AttachmentManagementPluginSettings) {
    this.plugin = plugin;
    this.app = this.plugin.app;
    this.settings = settings;
  }

  /**
   * Post-processing of created attachment file (for paste and drop event).
   * @param attach - the attachment file to process
   * @param source - the notes file that linked to attach
   * @returns - none
   */
  processAttach(attach: TFile, source: TFile) {
    info("pipe:paste", "processAttach start", {
      note: source.path,
      attach: attach.path,
      extension: attach.extension,
    });

    // ignore if the path of notes file has been excluded.
    if (source.parent && isExcluded(source.parent.path, this.settings)) {
      debugLog("processAttach - not a file or exclude path:", source.path);
      warn("pipe:paste", "skip: note path excluded", {
        note: source.path,
        attach: attach.path,
        reason: "excluded_path",
      });
      // new Notice(`${source.path} was excluded from attachment management.`);
      return;
    }

    // get override setting for the notes file or extension
    const { setting, settingPath } = getOverrideSetting(this.settings, source);
    const { extSetting } = getExtensionOverrideSetting(attach.extension, setting);

    info("pipe:paste", "effective setting resolved", {
      note: source.path,
      attach: attach.path,
      settingPath: settingPath === "" ? "GLOBAL" : settingPath,
      settingType: setting.type,
      saveAttE: setting.saveAttE,
      attachmentRoot: setting.attachmentRoot,
      attachmentPath: setting.attachmentPath,
      attachFormat: setting.attachFormat,
      hasExtensionOverride: extSetting !== undefined,
    });

    // No extension gate here: the attachment range is decided once, when the file
    // enters the queue (see the `create` handler), and this pipeline must match it.

    const metadata = getMetadata(source.path, attach);
    debugLog("processAttach - metadata:", metadata);

    const attachPath = metadata.getAttachmentPath(setting);
    info("pipe:paste", "target computed", { note: source.path, attach: attach.path, attachPath: attachPath });
    metadata
      .getAttachFileName(setting, this.settings.dateFormat, attach, this.app.vault.adapter)
      .then((attachName) => {
        attachName = attachName + "." + attach.extension;
        info("pipe:paste", "target name computed", { note: source.path, attach: attach.path, attachName: attachName });
        // make sure the attachment path was created
        this.app.vault.adapter
          .exists(attachPath, true)
          .then(async (exists) => {
            if (!exists) {
              await this.app.vault.adapter.mkdir(attachPath);
              debugLog("processAttach - create path:", attachPath);
              info("res:path", "attachment folder created", { path: attachPath });
            } else {
              trace("res:path", "attachment folder exists", { path: attachPath });
            }
          })
          .finally(() => {
            const attachPathFolder = this.app.vault.getAbstractFileByPath(attachPath) as TFolder;
            if (attachPathFolder === null || !(attachPathFolder instanceof TFolder)) {
              error("res:path", "target folder missing after mkdir", {
                note: source.path,
                attach: attach.path,
                attachPath: attachPath,
              });
              return;
            }
            // deduplicate the new name if needed
            deduplicateNewName(attachName, attachPathFolder)
              .then(({ name }) => {
                debugLog("processAttach - new path of file:", path.join(attachPath, name));
                if (name !== attachName) {
                  trace("pipe:paste", "name deduplicated", {
                    attach: attach.path,
                    requested: attachName,
                    resolved: name,
                  });
                }
                this.renameCreateFile(attach, attachPath, name, source);
              })
              .catch((err) => {
                error("pipe:paste", "deduplicateNewName failed", {
                  note: source.path,
                  attach: attach.path,
                  attachPath: attachPath,
                  err: err,
                });
              });
          })
          .catch((err) => {
            error("res:path", "failed to create attachment folder", {
              note: source.path,
              attachPath: attachPath,
              err: err,
            });
          });
      })
      .catch((err) => {
        error("pipe:paste", "getAttachFileName failed", {
          note: source.path,
          attach: attach.path,
          err: err,
        });
      });
  }

  /**
   * Rename the file specified by `@param file`, and update the link of the file if specified updateLink
   * @param attach - file to rename
   * @param attachPath - where to the renamed file will be move to
   * @param attachName - name of the renamed file
   * @param source - associated active file
   * @returns - none
   */
  renameCreateFile(attach: TFile, attachPath: string, attachName: string, source: TFile) {
    const dst = normalizePath(path.join(attachPath, attachName));
    debugLog("renameFile - ", attach.path, " to ", dst);

    const name = attach.name;
    // Capture the pre-rename basename so ${originalname} resolves to it on
    // future runs (rearrange, etc.), even after this file has been renamed.
    const originalBasename = attach.basename;

    // Generate the old link before renaming, to find and replace it later
    const oldLink = this.app.fileManager.generateMarkdownLink(attach, source.path);

    // Use vault.rename instead of fileManager.renameFile to avoid automatic link updates
    // that modify the source file on disk and cause the editor to reload (losing cursor/scroll position).
    this.app.vault
      .rename(attach, dst)
      .then(() => {
        info("pipe:paste", "attachment renamed", {
          note: source.path,
          path: dst,
          nameChanged: name !== attachName,
        });
        if (name !== attachName) {
          queueRenameNotice(name, attachName);
        }

        // Generate the new link after renaming (attach.path is now updated by vault.rename)
        const newLink = this.app.fileManager.generateMarkdownLink(attach, source.path);
        debugLog("renameFile - old link:", oldLink, "new link:", newLink);

        // Manually update the link in the source file
        this.updateLinkInSource(source, oldLink, newLink);
      })
      .catch((err) => {
        error("pipe:paste", "rename failed", { note: source.path, attach: attach.path, dst: dst, err: err });
      })
      .finally(() => {
        const { setting } = getOverrideSetting(this.settings, source);
        md5sum(this.app.vault.adapter, attach)
          .then((md5) => {
            saveOriginalName(this.settings, setting, attach.extension, {
              n: originalBasename,
              md5: md5,
            });
            trace("pipe:paste", "original name persisted", {
              attach: dst,
              originalBasename: originalBasename,
              md5: md5,
            });
            return this.plugin.saveData(this.settings);
          })
          .catch((err) => {
            // Without this the ${originalname} mapping is lost and the file keeps its
            // renamed basename forever, with nothing to show why.
            error("pipe:paste", "original name persistence failed", {
              note: source.path,
              attach: dst,
              originalBasename: originalBasename,
              err: err,
            });
          });
      });
  }

  /**
   * Update the old link to new link in the source file.
   * For markdown files with an active editor, use editor.replaceRange to avoid file reload and cursor jump.
   * For other cases (canvas, non-active files), fall back to adapter.process.
   * @param source - the source file containing the link
   * @param oldLink - the old link text to replace
   * @param newLink - the new link text
   */
  private updateLinkInSource(source: TFile, oldLink: string, newLink: string) {
    if (oldLink === newLink) {
      trace("pipe:paste", "link unchanged, nothing to update", { note: source.path, link: oldLink });
      return;
    }

    // For markdown files, try to use the editor API to avoid reload and cursor jump
    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (mdView && mdView.file && mdView.file.path === source.path && mdView.editor) {
      const editor = mdView.editor;
      const content = editor.getValue();
      const plan = planLinkRewrite(content, oldLink, newLink);
      if (plan !== null) {
        // Calculate line/ch positions for replaceRange using absolute offsets
        const before = content.substring(0, plan.from);
        const lines = before.split("\n");
        const fromLine = lines.length - 1;
        const fromCh = lines[fromLine].length;

        const toBefore = content.substring(0, plan.to);
        const toLines = toBefore.split("\n");
        const toLine = toLines.length - 1;
        const toCh = toLines[toLine].length;

        // replaceRange preserves cursor position and does not trigger a file reload
        editor.replaceRange(plan.text, { line: fromLine, ch: fromCh }, { line: toLine, ch: toCh });
        trace("pipe:paste", "link updated via editor API", {
          note: source.path,
          from: oldLink,
          to: newLink,
          annotationPreserved: plan.annotationPreserved,
        });
        return;
      }
    }

    // Fallback for canvas or non-active files: update via adapter.process
    this.app.vault.adapter
      .process(source.path, (data) => {
        // Recompute against the on-disk content: offsets from the editor are stale here.
        const plan = planLinkRewrite(data, oldLink, newLink);
        if (plan === null) {
          return data;
        }
        trace("pipe:paste", "link updated via adapter.process", {
          note: source.path,
          from: oldLink,
          to: newLink,
          annotationPreserved: plan.annotationPreserved,
        });
        return data.substring(0, plan.from) + plan.text + data.substring(plan.to);
      })
      .catch((err) => {
        // The attachment moved but the link still points at the old path, i.e. the note
        // is now broken. Nothing else reports this.
        error("pipe:paste", "link update via adapter.process failed", {
          note: source.path,
          from: oldLink,
          to: newLink,
          err: err,
        });
      });
  }
}
