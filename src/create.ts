import { App, Plugin, Notice, TFile, TFolder, debounce, normalizePath } from "obsidian";
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
import { updateLinkInNote } from "./lib/relink";
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

    const metadata = getMetadata(source.path, this.app, attach);
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
            const attachPathFolder = this.app.vault.getAbstractFileByPath(attachPath);
            if (!(attachPathFolder instanceof TFolder)) {
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
        updateLinkInNote(this.app, source, oldLink, newLink, "pipe:paste");
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
}
