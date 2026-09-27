import { App, TFile, TFolder } from "obsidian";
import { path } from "./lib/path";
import { debugLog } from "./lib/log";
import { error, info, trace, warn, warnOnce } from "./lib/logger";
import { getOverrideSetting } from "./override";
import { isAttachment } from "./utils";
import { AttachmentManagementPluginSettings, AttachmentPathSettings } from "./settings/settings";
import { SETTINGS_VARIABLES_DATES, SETTINGS_VARIABLES_NOTENAME } from "./lib/constant";
import { deduplicateNewName } from "./lib/deduplicate";
import { getMetadata } from "./settings/metadata";
import { getActiveFile } from "./commons";
import { isExcluded } from "./exclude";

// const bannerRegex = /!\[\[(.*?)\]\]/i;

export enum RearrangeType {
  ACTIVE,
  LINKS,
  FILE,
}

export class ArrangeHandler {
  pluginSettings: AttachmentManagementPluginSettings;
  app: App;

  constructor(settings: AttachmentManagementPluginSettings, app: App) {
    this.pluginSettings = settings;
    this.app = app;
  }

  /**
   * Rearranges attachments that are linked by markdown or canvas.
   * Only rearranges attachments if autoRenameAttachment is enabled in settings.
   *
   * @param {RearrangeType} type - The type of attachments to rearrange.
   * @param {TFile} file - The file to which the attachments are linked (optional), if the type was "file", thi should be provided.
   * @param {string} oldPath - The old path of the file (optional), used for rename event.
   */
  async rearrangeAttachment(type: RearrangeType, file?: TFile, oldPath?: string) {
    const startedAt = Date.now();
    info("cmd:arrange", "rearrange start", {
      type: RearrangeType[type],
      file: file?.path ?? "(none)",
      oldPath: oldPath ?? "(none)",
      autoRenameAttachment: this.pluginSettings.autoRenameAttachment,
    });

    if (!this.pluginSettings.autoRenameAttachment) {
      debugLog("rearrangeAttachment - autoRenameAttachment not enable");
      warn("cmd:arrange", "rearrange aborted", {
        type: RearrangeType[type],
        autoRenameAttachment: this.pluginSettings.autoRenameAttachment,
        reason: "gate_disabled",
      });
      return;
    }

    // only rearrange attachment that linked by markdown or canvas
    const attachments = await this.getAttachmentsInVault(this.pluginSettings, type, file, oldPath);
    debugLog("rearrangeAttachment - attachments:", Object.keys(attachments).length, Object.entries(attachments));
    info("cmd:arrange", "scan complete", {
      type: RearrangeType[type],
      noteCount: Object.keys(attachments).length,
      attachCount: Object.values(attachments).reduce((sum, links) => sum + links.size, 0),
    });

    if (type === RearrangeType.LINKS) {
      this.reportSharedAttachments(attachments);
    }

    let moved = 0;
    let skipped = 0;
    let failed = 0;

    for (const obNote of Object.keys(attachments)) {
      const innerFile = this.app.vault.getAbstractFileByPath(obNote);
      if (!(innerFile instanceof TFile) || isAttachment(this.app, this.pluginSettings, innerFile)) {
        debugLog(`rearrangeAttachment - ${obNote} not exists or is attachment, skipped`);
        trace("cmd:arrange", "skip note", { note: obNote, reason: "note_missing_or_attachment" });
        skipped += 1;
        continue;
      }
      const { setting, settingPath } = getOverrideSetting(this.pluginSettings, innerFile);

      if (attachments[obNote].size == 0) {
        trace("cmd:arrange", "skip note", { note: obNote, reason: "no_attachment" });
        continue;
      }

      // create attachment path if it's not exists
      const md = getMetadata(obNote);
      const attachPath = md.getAttachmentPath(setting);
      info("cmd:arrange", "note plan", {
        note: obNote,
        settingPath: settingPath === "" ? "GLOBAL" : settingPath,
        settingType: setting.type,
        attachPath: attachPath,
        attachCount: attachments[obNote].size,
      });
      if (!(await this.app.vault.adapter.exists(attachPath, true))) {
        // process the case where rename the filename to uppercase or lowercase
        if (oldPath != undefined && (await this.app.vault.adapter.exists(attachPath, false))) {
          const mdOld = getMetadata(oldPath);
          const attachPathOld = mdOld.getAttachmentPath(setting);
          // this will trigger the rename event and cause the path of attachment change
          info("res:path", "renaming attachment folder case", { from: attachPathOld, to: attachPath });
          this.app.vault.adapter.rename(attachPathOld, attachPath);
        } else {
          await this.app.vault.adapter.mkdir(attachPath);
          info("res:path", "attachment folder created", { path: attachPath, note: obNote });
        }
      }

      for (let link of attachments[obNote]) {
        try {
          link = decodeURI(link);
        } catch (err) {
          warn("cmd:arrange", "skip link", { note: obNote, link: link, reason: "invalid_link", err: err });
          skipped += 1;
          continue;
        }
        debugLog(`rearrangeAttachment - article: ${obNote} links: ${link}`);
        const linkFile = this.app.vault.getAbstractFileByPath(link);
        if (linkFile === null || !(linkFile instanceof TFile)) {
          debugLog(`${link} not exists, skipped`);
          // A stale vault can have many of these; WARN once per session, then count.
          warnOnce("cmd:arrange:link_target_missing", "cmd:arrange", "skip link", {
            note: obNote,
            link: link,
            reason: "link_target_missing",
          });
          skipped += 1;
          continue;
        }

        const metadata = getMetadata(obNote, linkFile);
        const attachName = await metadata.getAttachFileName(
          setting,
          this.pluginSettings.dateFormat,
          linkFile,
          this.app.vault.adapter,
          this.pluginSettings,
        );

        // ignore if the path was equal to current link
        if (attachPath == path.dirname(link) && attachName === path.basename(link, path.extname(link))) {
          trace("cmd:arrange", "skip link", {
            note: obNote,
            link: link,
            targetPath: attachPath,
            targetName: attachName,
            reason: "already_ok",
          });
          skipped += 1;
          continue;
        }

        const attachPathFolder = this.app.vault.getAbstractFileByPath(attachPath);
        if (attachPathFolder === null || !(attachPathFolder instanceof TFolder)) {
          debugLog(`${attachPath} not exists, skipped`);
          warn("cmd:arrange", "skip link", {
            note: obNote,
            link: link,
            attachPath: attachPath,
            reason: "target_folder_missing",
          });
          skipped += 1;
          continue;
        }
        const { name } = await deduplicateNewName(attachName + "." + path.extname(link), attachPathFolder);
        debugLog("rearrangeAttachment - deduplicated name:", name);

        const destination = path.join(attachPath, name);
        try {
          await this.app.fileManager.renameFile(linkFile, destination);
          info("cmd:arrange", "attachment moved", { note: obNote, from: link, to: destination });
          moved += 1;
        } catch (err) {
          error("cmd:arrange", "attachment move failed", {
            note: obNote,
            from: link,
            to: destination,
            err: err,
          });
          failed += 1;
        }
      }
    }

    info("cmd:arrange", "rearrange finished", {
      type: RearrangeType[type],
      moved: moved,
      skipped: skipped,
      failed: failed,
      elapsedMs: Date.now() - startedAt,
    });
  }

  /**
   * Report attachments referenced by more than one note. The current implementation
   * moves the shared attachment to the target path of whichever note is processed
   * first and rewrites every other note's link to that location, so the remaining
   * notes are silently skipped and no copy is created.
   */
  private reportSharedAttachments(attachments: Record<string, Set<string>>) {
    const refs = new Map<string, string[]>();
    for (const [note, links] of Object.entries(attachments)) {
      for (const link of links) {
        const notes = refs.get(link);
        if (notes === undefined) {
          refs.set(link, [note]);
        } else {
          notes.push(note);
        }
      }
    }
    const shared = Array.from(refs.entries()).filter(([, notes]) => notes.length > 1);
    if (shared.length === 0) {
      info("cmd:arrange", "no shared attachments", { uniqueAttachments: refs.size });
      return;
    }
    warn("cmd:arrange", "shared attachments detected", {
      count: shared.length,
      uniqueAttachments: refs.size,
      sample: shared.slice(0, 20).map(([attach, notes]) => ({ attach: attach, refCount: notes.length, notes: notes })),
      behavior: "current_move_first_wins",
    });
  }

  /**
   * Retrieves the attachments in the vault based on the specified settings and type.
   * If a file is provided, only attachments related to that file will be returned.
   *
   * @param {AttachmentManagementPluginSettings} settings - The settings for the attachment management plugin.
   * @param {RearrangeType} type - The type of attachments to retrieve.
   * @param {TFile} [file] - The file to filter attachments by. Optional.
   * @return {Promise<Record<string, Set<string>>>} - A promise that resolves to a record of attachments, where each key is a file name and each value is a set of associated attachment names.
   */
  async getAttachmentsInVault(
    settings: AttachmentManagementPluginSettings,
    type: RearrangeType,
    file?: TFile,
    oldPath?: string,
  ): Promise<Record<string, Set<string>>> {
    let attachmentsRecord: Record<string, Set<string>> = {};

    attachmentsRecord = await this.getAttachmentsInVaultByLinks(settings, type, file, oldPath);

    return attachmentsRecord;
  }

  /**
   * Modified from https://github.com/ozntel/oz-clear-unused-images-obsidian/blob/master/src/util.ts#LL48C21-L48C21
   * Retrieves a record of attachments in the vault based on the given settings and type.
   *
   * @param {AttachmentManagementPluginSettings} settings - The settings for the attachment management plugin.
   * @param {RearrangeType} type - The type of attachments to retrieve.
   * @param {TFile} file - The file to retrieve attachments for (optional).
   * @return {Promise<Record<string, Set<string>>>} - A promise that resolves to a record of attachments.
   */
  async getAttachmentsInVaultByLinks(
    settings: AttachmentManagementPluginSettings,
    type: RearrangeType,
    file?: TFile,
    oldPath?: string,
  ): Promise<Record<string, Set<string>>> {
    const attachmentsRecord: Record<string, Set<string>> = {};
    let resolvedLinks: Record<string, Record<string, number>> = {};
    let allFiles: TFile[] = [];
    // Where the link data came from. `cache` is the normal source; `old_path` means the
    // metadata cache had no entry for the renamed file yet and the pre-rename key was
    // used as a fallback. An empty scan is otherwise indistinguishable from a vault that
    // genuinely has no linked attachments.
    let source = "none";
    if (type == RearrangeType.LINKS) {
      // resolvedLinks was not working for canvas file
      resolvedLinks = this.app.metadataCache.resolvedLinks;
      allFiles = this.app.vault.getFiles();
      source = "vault_cache";
    } else if (type == RearrangeType.ACTIVE) {
      const file = getActiveFile(this.app);
      if (file) {
        if (
          (file.parent && isExcluded(file.parent.path, this.pluginSettings)) ||
          isAttachment(this.app, this.pluginSettings, file)
        ) {
          allFiles = [];
          source = "active_note_skipped";
          // new Notice(`${file.path} was excluded, skipped`);
        } else {
          debugLog("getAttachmentsInVaultByLinks - active:", file.path);
          allFiles = [file];
          if (this.app.metadataCache.resolvedLinks[file.path]) {
            resolvedLinks[file.path] = this.app.metadataCache.resolvedLinks[file.path];
            source = "active_note_cache";
          } else {
            source = "active_note_no_cache_entry";
          }
          debugLog("getAttachmentsInVaultByLinks - resolvedLinks:", resolvedLinks);
        }
      } else {
        source = "no_active_file";
      }
    } else if (type == RearrangeType.FILE && file != undefined) {
      if (
        (file.parent && isExcluded(file.parent.path, this.pluginSettings)) ||
        isAttachment(this.app, this.pluginSettings, file)
      ) {
        allFiles = [];
        source = "file_skipped";
        // new Notice(`${file.path} was excluded, skipped`);
      } else {
        debugLog("getAttachmentsInVaultByLinks - file:", file.path);
        allFiles = [file];
        const rlinks = this.app.metadataCache.resolvedLinks[file.path];
        if (rlinks) {
          debugLog("getAttachmentsInVaultByLinks - rlinks:", rlinks);
          resolvedLinks[file.path] = rlinks;
          source = "cache";
        } else if (oldPath) {
          debugLog("getAttachmentsInVaultByLinks - oldPath:", oldPath);
          // in some cases, this.app.metadataCache.resolvedLinks[file.path] will be empty since the cache is not updated
          resolvedLinks[file.path] = this.app.metadataCache.resolvedLinks[oldPath];
          source = "old_path";
        } else {
          source = "file_no_cache_entry";
        }
        debugLog("getAttachmentsInVaultByLinks - resolvedLinks:", resolvedLinks);
      }
    } else {
      source = "file_arg_missing";
    }

    debugLog("getAttachmentsInVaultByLinks - allFiles:", allFiles.length, allFiles);

    if (resolvedLinks) {
      for (const [mdFile, links] of Object.entries(resolvedLinks)) {
        const attachmentsSet: Set<string> = new Set();
        if (links) {
          for (const [filePath] of Object.entries(links)) {
            if (isAttachment(this.app, settings, filePath)) {
              this.addToSet(attachmentsSet, filePath);
            }
          }
          this.addToRecord(attachmentsRecord, mdFile, attachmentsSet);
        }
      }
    }

    const noteCount = Object.keys(attachmentsRecord).length;
    const attachCount = Object.values(attachmentsRecord).reduce((sum, links) => sum + links.size, 0);
    debugLog("getAttachmentsInVaultByLinks - scan result:", source, noteCount, attachCount);
    if (attachCount === 0) {
      warn("cmd:arrange", "link scan found no attachments", {
        type: RearrangeType[type],
        source: source,
        file: file?.path ?? "(none)",
        oldPath: oldPath ?? "(none)",
        resolvedLinkNotes: Object.keys(resolvedLinks).length,
        allFiles: allFiles.length,
        reason: "empty_scan",
      });
    } else {
      // Once per scan, so INFO: `source` distinguishes a real cache hit from the
      // pre-rename fallback, which is what makes an unexpected scan result explainable.
      info("cmd:arrange", "link scan result", {
        type: RearrangeType[type],
        source: source,
        noteCount: noteCount,
        attachCount: attachCount,
      });
    }
    // Loop Files and Check Frontmatter/Canvas
    // for (let i = 0; i < allFiles.length; i++) {
    //   const obsFile = allFiles[i];
    //   const attachmentsSet: Set<string> = new Set();

    //   if (obsFile.parent && isExcluded(obsFile.parent.path, this.settings)) {
    //     continue;
    //   }

    //   // Check Frontmatter for md files and additional links that might be missed in resolved links
    //   if (isMarkdownFile(obsFile.extension)) {
    //     // Frontmatter
    //     const fileCache = this.app.metadataCache.getFileCache(obsFile);
    //     if (fileCache === null) {
    //       continue;
    //     }
    //     if (fileCache.frontmatter) {
    //       const frontmatter = fileCache.frontmatter;
    //       for (const k of Object.keys(frontmatter)) {
    //         if (typeof frontmatter[k] === "string") {
    //           const formatMatch = frontmatter[k].match(bannerRegex);
    //           if (formatMatch && formatMatch[1]) {
    //             const fileName = formatMatch[1];
    //             const file = this.app.metadataCache.getFirstLinkpathDest(fileName, obsFile.path);
    //             if (file && isAttachment(this.app, settings, file.path)) {
    //               this.addToSet(attachmentsSet, file.path);
    //             }
    //           }
    //         }
    //       }
    //     }
    //     // Any Additional Link
    //     const linkMatches: LinkMatch[] = await getAllLinkMatchesInFile(obsFile, this.app);
    //     for (const linkMatch of linkMatches) {
    //       if (isAttachment(this.app, settings, linkMatch.linkText)) {
    //         this.addToSet(attachmentsSet, linkMatch.linkText);
    //       }
    //     }
    //   } else if (isCanvasFile(obsFile.extension)) {
    //     // check canvas for links
    //     const fileRead = await this.app.vault.cachedRead(obsFile);
    //     if (!fileRead || fileRead.length === 0) {
    //       continue;
    //     }
    //     let canvasData;
    //     try {
    //       canvasData = JSON.parse(fileRead);
    //     } catch (e) {
    //       debugLog("getAttachmentsInVaultByLinks - parse canvas data error", e);
    //       continue;
    //     }
    //     // debugLog("canvasData", canvasData);
    //     if (canvasData.nodes && canvasData.nodes.length > 0) {
    //       for (const node of canvasData.nodes) {
    //         // node.type: 'text' | 'file'
    //         if (node.type === "file") {
    //           if (isAttachment(this.app, settings, node.file)) {
    //             this.addToSet(attachmentsSet, node.file);
    //           }
    //         } else if (node.type == "text") {
    //           const linkMatches: LinkMatch[] = await getAllLinkMatchesInFile(obsFile, this.app, node.text);
    //           for (const linkMatch of linkMatches) {
    //             if (isAttachment(this.app, settings, linkMatch.linkText)) {
    //               this.addToSet(attachmentsSet, linkMatch.linkText);
    //             }
    //           }
    //         }
    //       }
    //     }
    //   }
    //   this.addToRecord(attachmentsRecord, obsFile.path, attachmentsSet);
    // }
    return attachmentsRecord;
  }

  addToRecord(record: Record<string, Set<string>>, key: string, value: Set<string>) {
    if (record[key] === undefined) {
      record[key] = value;
      return;
    }
    const valueSet = record[key];

    for (const val of value) {
      this.addToSet(valueSet, val);
    }

    record[key] = valueSet;
  }

  addToSet(setObj: Set<string>, value: string) {
    if (!setObj.has(value)) {
      setObj.add(value);
    }
  }

  needToRename(
    settings: AttachmentPathSettings,
    attachPath: string,
    attachName: string,
    noteName: string,
    link: string,
  ): boolean {
    const linkPath = path.dirname(link);
    const linkName = path.basename(link, path.extname(link));

    if (linkName.length !== attachName.length) {
      return true;
    }

    if (attachPath !== linkPath) {
      return true;
    } else {
      if (settings.attachFormat.includes(SETTINGS_VARIABLES_NOTENAME) && !linkName.includes(noteName)) {
        return true;
      }
      // suppose the ${notename} was in format
      const noNoteNameAttachFormat = settings.attachFormat.split(SETTINGS_VARIABLES_NOTENAME);
      if (settings.attachFormat.includes(SETTINGS_VARIABLES_DATES)) {
        for (const formatPart in noNoteNameAttachFormat) {
          // suppose the ${date} was in format, split each part and search in linkName
          const splited = formatPart.split(SETTINGS_VARIABLES_DATES);
          for (const part in splited) {
            if (!linkName.includes(part)) {
              return true;
            }
          }
        }
      }
    }

    return false;
  }
}
