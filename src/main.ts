import { Notice, Plugin, TAbstractFile, TFile, TFolder } from "obsidian";
import {
  AttachmentManagementPluginSettings,
  AttachmentPathSettings,
  DEFAULT_SETTINGS,
  SETTINGS_TYPES,
  AttachmentManagementSettingTab,
} from "./settings/settings";
import { debugLog } from "./lib/log";
import { error, flushLog, info, initLogger, setLogEnabled, trace, warn, warnOnce } from "./lib/logger";
import { OverrideModal } from "./model/override";
import { initI18n, t } from "./i18n/index";
import { ConfirmModal } from "./model/confirm";
import { checkEmptyFolder, getActiveFile } from "./commons";
import {
  auditOverrideKeys,
  deleteOverrideSetting,
  getOverrideSetting,
  getRenameOverrideSetting,
  updateOverrideSetting,
} from "./override";
import { isNonNoteFile, isMarkdownFile, isCanvasFile, matchExtension, md5sum } from "./utils";
import { ArrangeHandler, RearrangeType } from "./arrange";
import { CreateHandler } from "./create";
import { isExcluded } from "./exclude";
import { getMetadata } from "./settings/metadata";
import { findWikiLink, wikiLinkTarget } from "./lib/embed";

// Normally a queued attachment is consumed within a modify event or two. If its link never
// appears (the note is never written, or another plugin rewrites the embed into a form we
// cannot recognize), the entry only leaks, so it is dropped and reported.
const QUEUE_MAX_RESIDENCY_MS = 60_000;
const QUEUE_MAX_SCANS = 50;

export default class AttachmentManagementPlugin extends Plugin {
  settings!: AttachmentManagementPluginSettings;
  createdQueue: TFile[] = [];

  /**
   * The queue snapshot last reported as unmatched. Every modify re-examines the whole
   * queue, so repeats are collapsed to TRACE: the first report at WARN is the actionable
   * signal, the repeats are noise. Cleared when the queue empties so a later block on the
   * same set is reported again.
   */
  private reportedQueueSignature = "";
  private reportedQueueRepeats = 0;

  /** Enqueue time and scan count per queued path, for the stale-drop backstop. */
  private queueEntries = new Map<string, { enqueuedAt: number; scans: number }>();

  async onload() {
    await this.loadSettings();

    // Bootstrap diagnostics first so the reload rotation and the load banner are
    // the first thing in the log. Failures degrade to console-only output.
    setLogEnabled(this.settings.debugLogEnabled);
    await initLogger(this.app, {
      pluginId: this.manifest.id,
      version: this.manifest.version,
      configDir: this.app.vault.configDir,
      verbose: this.settings.debugLogEnabled,
    });

    // Initilize i18n
    initI18n();

    info("sys:log", "plugin loading", {
      version: this.manifest.version,
      autoRenameAttachment: this.settings.autoRenameAttachment,
      excludeExtensionPattern: this.settings.excludeExtensionPattern,
      excludedPaths: this.settings.excludedPaths,
      saveAttE: this.settings.attachPath.saveAttE,
      attachmentRoot: this.settings.attachPath.attachmentRoot,
      attachmentPath: this.settings.attachPath.attachmentPath,
      attachFormat: this.settings.attachPath.attachFormat,
    });

    // Stale override keys silently disable their own override: a key is matched by
    // exact path (file) or path prefix (folder), so a key pointing at a path that no
    // longer exists can never match again and the setting silently falls back to global.
    const overrideAudit = auditOverrideKeys(this.app, this.settings);
    info("res:override", "override keys audit", {
      total: overrideAudit.total,
      keys: Object.keys(this.settings.overridePath),
    });
    if (overrideAudit.stale.length > 0) {
      warn("res:override", "stale override keys detected", {
        count: overrideAudit.stale.length,
        keys: overrideAudit.stale,
        reason: "stale_override_key",
      });
    }

    this.app.workspace.onLayoutReady(() => {
      this.initCommands();

      this.registerEvent(
        this.app.workspace.on("file-menu", async (menu, file) => {
          if ((file.parent && isExcluded(file.parent.path, this.settings)) || isNonNoteFile(file)) {
            return;
          }
          menu.addItem((item) => {
            item
              .setTitle(t("override.menuTitle"))
              .setIcon("image-plus")
              .onClick(async () => {
                const { setting, settingPath } = getOverrideSetting(this.settings, file);
                info("res:override", "override modal requested", {
                  target: file.path,
                  targetType: file instanceof TFile ? "file" : "folder",
                  inheritedFrom: settingPath === "" ? "GLOBAL" : settingPath,
                  settingType: setting.type,
                });
                // Deep copy
                const fileSetting = Object.assign({}, setting);
                this.overrideConfiguration(file, fileSetting);
              });
          });
        }),
      );

      this.registerEvent(
        this.app.vault.on("create", async (file: TAbstractFile) => {
          trace("evt:create", "create event", { path: file.path });

          // The log file itself lives in the config dir, which is not indexed by the
          // vault, so it should never reach this handler. Guard anyway: a file created
          // here would be queued forever (no note ever links to it) and would block the
          // whole paste pipeline.
          if (file.path.startsWith(this.app.vault.configDir + "/")) {
            trace("evt:create", "skip: config dir", { path: file.path, reason: "config_dir" });
            return;
          }

          // only processing creatation of file, ignore folder creation
          if (!(file instanceof TFile)) {
            trace("evt:create", "skip: not a file", { path: file.path, reason: "not_a_file" });
            return;
          }

          // if the file was modified/create more than 1 second ago, the event is most likely be fired by copy file to
          // vault folder without using obsidian or sync file from remote (e.g. file manager of os), we should ignore it.
          const curentTime = new Date().getTime();
          const timeGapMs = curentTime - file.stat.mtime;
          const timeGapCs = curentTime - file.stat.ctime;
          // ignore markdown and canvas file.
          if (isMarkdownFile(file.extension) || isCanvasFile(file.extension)) {
            trace("evt:create", "skip: note or canvas", {
              path: file.path,
              extension: file.extension,
              reason: "note_or_canvas",
            });
            return;
          }
          if (timeGapMs > 1000 || timeGapCs > 1000) {
            // Fires once per file that sync/OS-copy drops in, i.e. potentially hundreds of
            // times after a sync. WARN once per session, then count.
            warnOnce("evt:create:timegap", "evt:create", "skip: created outside paste window", {
              path: file.path,
              timeGapMs: timeGapMs,
              timeGapCs: timeGapCs,
              mtime: file.stat.mtime,
              ctime: file.stat.ctime,
              now: curentTime,
              reason: "timegap",
            });
            return;
          }

          // ignore excluded extension
          if (matchExtension(file.extension, this.settings.excludeExtensionPattern)) {
            warnOnce("evt:create:excluded_extension", "evt:create", "skip: excluded extension", {
              path: file.path,
              extension: file.extension,
              pattern: this.settings.excludeExtensionPattern,
              reason: "excluded_extension",
            });
            return;
          }

          // add the created file to queue for processing in modify event (obsidian will add link to the file that will trigger modify event)
          this.createdQueue.push(file);
          this.queueEntries.set(file.path, { enqueuedAt: Date.now(), scans: 0 });
          info("evt:create", "queued for paste processing", {
            path: file.path,
            queueLen: this.createdQueue.length,
            queue: this.createdQueue.map((queued) => queued.path),
          });
        }),
      );

      this.registerEvent(
        this.app.vault.on("modify", (file: TAbstractFile) => {
          if (!(file instanceof TFile)) {
            return;
          }
          // ignore if no file in the created queue
          // (deliberately not logged: modify fires on every autosave, and the empty queue
          // is the normal state, so tracing it would bury the paste chain. An empty queue
          // at paste time shows up as a missing `evt:create` line instead.)
          if (this.createdQueue.length < 1) {
            return;
          }

          trace("evt:modify", "modify event", {
            note: file.path,
            queueLen: this.createdQueue.length,
            queue: this.createdQueue.map((queued) => queued.path),
          });
          // Use cachedRead instead of adapter.process to avoid writing the file back,
          // which would cause the editor to refresh and lose cursor position/focus.
          this.app.vault
            .cachedRead(file)
            .then((data) =>
              this.processQueueForNote(file, data).catch((err) => {
                // Logged separately from the read: attributing a processing failure to
                // cachedRead would send the diagnosis down the wrong path.
                error("evt:modify", "queue processing failed", { note: file.path, err: err });
              }),
            )
            .catch((err) => {
              error("evt:modify", "cachedRead failed", { note: file.path, err: err });
            });
        }),
      );

      this.registerEvent(
        // when trigger a rename event on folder, for each file/folder in this renamed folder (include itself) will trigger this event
        this.app.vault.on("rename", async (file: TAbstractFile, oldPath: string) => {
          trace("evt:rename", "rename event", { newPath: file.path, oldPath: oldPath });

          // ignore anything that is not a note
          if (isNonNoteFile(file)) {
            trace("evt:rename", "skip: not a note", { path: file.path, reason: "not_a_note" });
            return;
          }

          const { setting, settingPath } = getRenameOverrideSetting(this.settings, file, oldPath);
          info("res:override", "rename: override resolution", {
            newPath: file.path,
            oldPath: oldPath,
            settingPath: settingPath,
            settingType: setting.type,
          });
          // update the override setting
          if (setting.type === SETTINGS_TYPES.FOLDER || setting.type === SETTINGS_TYPES.FILE) {
            updateOverrideSetting(this.settings, file, oldPath);
            this.saveSettings().catch((err) => {
              // The re-keyed override is only in memory; a failed write means the rename
              // is undone on the next reload and the override silently stops matching.
              error("res:override", "failed to persist override keys after rename", {
                newPath: file.path,
                oldPath: oldPath,
                err: err,
              });
            });
          }
          trace("evt:rename", "override keys after rename", {
            newPath: file.path,
            keys: Object.keys(this.settings.overridePath),
          });

          if (!this.settings.autoRenameAttachment) {
            trace("evt:rename", "skip: auto rename disabled", {
              path: file.path,
              reason: "auto_rename_disabled",
            });
            return;
          }

          if (file instanceof TFile) {
            if (file.parent && isExcluded(file.parent.path, this.settings)) {
              warn("evt:rename", "skip: excluded path", {
                path: file.path,
                parent: file.parent.path,
                reason: "excluded_path",
              });
              new Notice(t("notices.fileExcluded", { path: file.path }));
              return;
            }

            await new ArrangeHandler(this.settings, this.app).rearrangeAttachment(RearrangeType.FILE, file, oldPath);

            const oldMetadata = getMetadata(oldPath);
            const oldAttachPath = oldMetadata.getAttachmentPath(setting);
            this.app.vault.adapter
              .exists(oldAttachPath, true)
              .then((exists) => {
                if (exists) {
                  // check and remove the old attachment folder if it is empty
                  checkEmptyFolder(this.app.vault.adapter, oldAttachPath)
                    .then((empty) => {
                      if (empty) {
                        info("res:path", "removing empty attachment folder", { path: oldAttachPath });
                        return this.app.vault.adapter.rmdir(oldAttachPath, true);
                      }
                    })
                    .catch((err) => {
                      // A stale empty attachment folder is left on disk. Nothing else
                      // reports this, so it would look like the cleanup never ran.
                      error("res:path", "failed to remove empty attachment folder", {
                        path: oldAttachPath,
                        err: err,
                      });
                    });
                }
              })
              .catch((err) => {
                error("res:path", "attachment folder existence check failed", { path: oldAttachPath, err: err });
              });
          } else if (file instanceof TFolder) {
            // ignore rename event of folder
            trace("evt:rename", "skip: folder rename body", { path: file.path, reason: "folder" });
            return;
          }
        }),
      );

      this.registerEvent(
        this.app.vault.on("delete", async (file: TAbstractFile) => {
          trace("evt:delete", "delete event", { path: file.path });

          if ((file.parent && isExcluded(file.parent.path, this.settings)) || isNonNoteFile(file)) {
            trace("evt:delete", "skip: excluded path or not a note", {
              path: file.path,
              reason: "excluded_or_not_a_note",
            });
            return;
          }

          if (file instanceof TFile) {
            const oldMetadata = getMetadata(file.path);
            const { setting } = getOverrideSetting(this.settings, file);
            const oldAttachPath = oldMetadata.getAttachmentPath(setting);
            this.app.vault.adapter
              .exists(oldAttachPath, true)
              .then((exists) => {
                if (exists) {
                  // check and remove the old attachment folder if it is empty
                  checkEmptyFolder(this.app.vault.adapter, oldAttachPath)
                    .then((empty) => {
                      if (empty) {
                        info("res:path", "removing empty attachment folder", { path: oldAttachPath });
                        return this.app.vault.adapter.rmdir(oldAttachPath, true);
                      }
                    })
                    .catch((err) => {
                      // A stale empty attachment folder is left on disk. Nothing else
                      // reports this, so it would look like the cleanup never ran.
                      error("res:path", "failed to remove empty attachment folder", {
                        path: oldAttachPath,
                        err: err,
                      });
                    });
                }
              })
              .catch((err) => {
                error("res:path", "attachment folder existence check failed", { path: oldAttachPath, err: err });
              });
          }

          const keysBefore = Object.keys(this.settings.overridePath);
          if (deleteOverrideSetting(this.settings, file)) {
            await this.saveSettings();
            info("res:override", "override removed on delete", {
              path: file.path,
              keysBefore: keysBefore,
              keysAfter: Object.keys(this.settings.overridePath),
            });
            new Notice(t("notices.overrideRemoved", { path: file.path }));
          } else if (keysBefore.length > 0) {
            trace("res:override", "no override key for deleted target", {
              path: file.path,
              keys: keysBefore,
              reason: "no_exact_key",
            });
          }
        }),
      );

      // This adds a settings tab so the user can configure various aspects of the plugin
      this.addSettingTab(new AttachmentManagementSettingTab(this.app, this));
    });
  }

  async overrideConfiguration(file: TAbstractFile, setting: AttachmentPathSettings) {
    new OverrideModal(this, file, setting).open();
  }

  private dropFromQueue(file: TFile) {
    this.createdQueue.remove(file);
    this.queueEntries.delete(file.path);
  }

  /**
   * Try to consume the created queue against the modified note. Scans every queued candidate
   * (not just the head), because a single unmatched head must not block the attachments behind
   * it and one modify may insert several links at once.
   */
  private async processQueueForNote(note: TFile, data: string): Promise<void> {
    const processor = new CreateHandler(this, this.settings);
    const matched: TFile[] = [];
    const checked: { attach: string; expectedLink: string }[] = [];

    // Snapshot: the queue is mutated while iterating.
    for (const candidate of [...this.createdQueue]) {
      // Keep the original order: existence first, then link matching.
      let exists = false;
      try {
        exists = await this.app.vault.adapter.exists(candidate.path, true);
      } catch (err) {
        error("evt:modify", "queue file existence check failed", {
          note: note.path,
          attach: candidate.path,
          err: err,
        });
        continue;
      }
      if (!exists) {
        warn("evt:modify", "drop queued file: no longer exists", {
          note: note.path,
          attach: candidate.path,
          reason: "queue_file_missing",
        });
        this.dropFromQueue(candidate);
        continue;
      }

      const link = this.app.fileManager.generateMarkdownLink(candidate, note.path);
      let matchKind: "exact" | "params" | null = null;
      if (note.extension == "md") {
        if (data.indexOf(link) != -1) {
          matchKind = "exact";
        } else {
          const target = wikiLinkTarget(link);
          if (target !== null && findWikiLink(data, target) !== null) {
            matchKind = "params";
          }
        }
      } else if (note.extension == "canvas" && data.indexOf(candidate.path) != -1) {
        matchKind = "exact";
      }

      if (matchKind !== null) {
        info("pipe:paste", "link matched", {
          note: note.path,
          attach: candidate.path,
          matchedForm: note.extension,
          matchKind: matchKind,
          queueLen: this.createdQueue.length,
        });
        // rename the attachment file `candidate`
        processor.processAttach(candidate, note);
        matched.push(candidate);
      } else {
        checked.push({ attach: candidate.path, expectedLink: link });
      }
    }

    for (const file of matched) {
      this.dropFromQueue(file);
    }
    if (matched.length > 0) {
      this.reportedQueueSignature = "";
      this.reportedQueueRepeats = 0;
    }

    // Report what this pass did not consume, before any stale drops below.
    if (checked.length > 0) {
      const signature = this.createdQueue.map((queued) => queued.path).join("|");
      const queueHead = this.createdQueue.first()?.path ?? "";
      if (signature === this.reportedQueueSignature) {
        this.reportedQueueRepeats += 1;
      } else {
        this.reportedQueueSignature = signature;
        this.reportedQueueRepeats = 0;
      }
      const blocked = {
        note: note.path,
        attach: queueHead,
        expectedLink: checked[0].expectedLink,
        expectedLinks: checked,
        dataLen: data.length,
        queueLen: this.createdQueue.length,
        queueHead: queueHead,
        queue: this.createdQueue.map((queued) => queued.path),
        repeat: this.reportedQueueRepeats,
        reason: "link_not_found",
      };
      if (this.reportedQueueRepeats === 0) {
        warn("evt:modify", "link not found in modified note", blocked);
      } else {
        trace("evt:modify", "link not found in modified note (repeat)", blocked);
      }
    }

    // Stale-drop backstop: everything still queued missed this pass too.
    const now = Date.now();
    for (const candidate of [...this.createdQueue]) {
      const entry = this.queueEntries.get(candidate.path);
      if (entry === undefined) {
        continue;
      }
      entry.scans += 1;
      const residencyMs = now - entry.enqueuedAt;
      if (residencyMs > QUEUE_MAX_RESIDENCY_MS || entry.scans >= QUEUE_MAX_SCANS) {
        warn("evt:modify", "drop queued file: link never appeared", {
          note: note.path,
          attach: candidate.path,
          queueLen: this.createdQueue.length,
          residencyMs: residencyMs,
          scans: entry.scans,
          reason: "queue_stale",
        });
        this.dropFromQueue(candidate);
      }
    }
  }

  /**
   * Initializes and registers the plugin's commands
   * This method is responsible for setting up the user interface by adding various commands.
   * These commands include settings overrides, resetting settings, clearing unused original name storage,
   * and rearranging attachments.
   *
   * Note: The actual implementation of each command is not included in this method and needs to be
   * defined separately asynchronously.
   *
   * Warning: Make sure you have checked for errors while implementing the functionality of each command.
   */
  initCommands() {
    this.addCommand({
      id: "attachment-management-rearrange-all-links",
      name: t("commands.rearrangeAllLinks"),
      callback: async () => {
        info("cmd:arrange", "command invoked", {
          command: "rearrangeAllLinks",
          autoRenameAttachment: this.settings.autoRenameAttachment,
          activeFile: getActiveFile(this.app)?.path ?? "(none)",
        });
        new ConfirmModal(this).open();
      },
    });

    this.addCommand({
      id: "attachment-management-rearrange-active-links",
      name: t("commands.rearrangeActiveLinks"),
      callback: async () => {
        info("cmd:arrange", "command invoked", {
          command: "rearrangeActiveLinks",
          autoRenameAttachment: this.settings.autoRenameAttachment,
          activeFile: getActiveFile(this.app)?.path ?? "(none)",
        });
        // `.finally` alone means a rejected rearrange still showed "completed" and the
        // rejection was unhandled, so a failed run was indistinguishable from a run that
        // found nothing to do.
        new ArrangeHandler(this.settings, this.app)
          .rearrangeAttachment(RearrangeType.ACTIVE)
          .catch((err) => {
            error("cmd:arrange", "rearrange failed", { command: "rearrangeActiveLinks", err: err });
          })
          .finally(() => {
            new Notice(t("notices.arrangeCompleted"));
          });
      },
    });

    this.addCommand({
      id: "attachment-management-override-setting",
      name: t("commands.overrideSetting"),
      checkCallback: (checking: boolean) => {
        const file = getActiveFile(this.app);

        if (file) {
          if (isNonNoteFile(file)) {
            return true;
          }

          if (!checking) {
            if (file.parent && isExcluded(file.parent.path, this.settings)) {
              new Notice(t("notices.fileExcluded", { path: file.path }));
              return true;
            }
            const { setting, settingPath } = getOverrideSetting(this.settings, file);
            const fileSetting = Object.assign({}, setting);
            info("res:override", "override modal requested", {
              target: file.path,
              targetType: file instanceof TFile ? "file" : "folder",
              inheritedFrom: settingPath === "" ? "GLOBAL" : settingPath,
              settingType: setting.type,
            });
            this.overrideConfiguration(file, fileSetting);
          }
          return true;
        }
        return false;
      },
    });

    // The palette entry names its target, and the target is the active file, so the name
    // is refreshed whenever the active note changes. With no note open the path is empty,
    // but `checkCallback` hides the command in that state, so the empty name is never shown.
    const resetOverrideCommand = this.addCommand({
      id: "attachment-management-reset-override-setting",
      name: t("commands.resetOverrideSetting", { path: getActiveFile(this.app)?.path ?? "" }),
      checkCallback: (checking: boolean) => {
        const file = getActiveFile(this.app);
        if (file) {
          if (isNonNoteFile(file)) {
            return true;
          }

          if (!checking) {
            if (file.parent && isExcluded(file.parent.path, this.settings)) {
              new Notice(t("notices.fileExcluded", { path: file.path }));
              return true;
            }
            const keyExisted = this.settings.overridePath[file.path] !== undefined;
            const { settingPath } = getOverrideSetting(this.settings, file);
            if (!keyExisted) {
              // Deleting by path only removes a file-level override. A note governed by a
              // folder override has no key of its own, so this reset is a no-op while still
              // reporting success.
              warn("res:override", "reset override is a no-op", {
                target: file.path,
                governedBy: settingPath === "" ? "GLOBAL" : settingPath,
                reason: "no_exact_key",
              });
            }
            delete this.settings.overridePath[file.path];
            this.saveSettings()
              .catch((err) => {
                // The removal is only in memory; on reload the override comes back, which
                // looks like "reset did nothing".
                error("res:override", "failed to persist override reset", {
                  target: file.path,
                  keyExisted: keyExisted,
                  err: err,
                });
              })
              .finally(() => {
                info("res:override", "override reset", {
                  target: file.path,
                  keyExisted: keyExisted,
                  keysAfter: Object.keys(this.settings.overridePath),
                });
                new Notice(t("notices.resetAttachmentSetting", { path: file.path }));
              });
          }
          return true;
        }
        return false;
      },
    });

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        resetOverrideCommand.name = t("commands.resetOverrideSetting", {
          path: getActiveFile(this.app)?.path ?? "",
        });
      }),
    );

    this.addCommand({
      id: "attachment-management-clear-unused-originalname-storage",
      name: t("commands.clearUnusedStorage"),
      callback: async () => {
        // An async command callback's rejection is not observed by Obsidian, so without
        // this the command would just appear to do nothing.
        try {
          const storageBefore = this.settings.originalNameStorage.length;
          const attachments = await new ArrangeHandler(this.settings, this.app).getAttachmentsInVault(
            this.settings,
            RearrangeType.LINKS,
          );
          const validMd5s = new Set<string>();
          for (const attachs of Object.values(attachments)) {
            for (const attach of attachs) {
              const link = decodeURI(attach);
              const linkFile = this.app.vault.getAbstractFileByPath(link);
              if (linkFile instanceof TFile) {
                validMd5s.add(await md5sum(this.app.vault.adapter, linkFile));
              }
            }
          }
          this.settings.originalNameStorage = this.settings.originalNameStorage.filter((s) => validMd5s.has(s.md5));
          debugLog("clearUnusedOriginalNameStorage - storage:", this.settings.originalNameStorage);
          await this.saveSettings();
          info("cmd:arrange", "original name storage pruned", {
            before: storageBefore,
            after: this.settings.originalNameStorage.length,
            validMd5: validMd5s.size,
          });
        } catch (err) {
          error("cmd:arrange", "clear unused original name storage failed", { err: err });
        }
      },
    });
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async onunload() {
    info("sys:log", "plugin unload", { queueLen: this.createdQueue.length });
    flushLog();
    // Clear the queue of created file.
    this.createdQueue = [];
    this.queueEntries.clear();
  }
}
