import { Modal, TFile, TAbstractFile, Setting, TFolder, Notice } from "obsidian";
import { AttachmentPathSettings, DEFAULT_SETTINGS, SETTINGS_TYPES } from "../settings/settings";
import { SETTINGS_ROOT_OBSFOLDER, SETTINGS_ROOT_INFOLDER, SETTINGS_ROOT_NEXTTONOTE } from "../lib/constant";
import AttachmentManagementPlugin from "../main";
import { createLayerBox, renderExceptionArea, renderOrderLegend } from "../settings/exceptionArea";
import { attachFolderSuggest } from "../lib/folderSuggest";
import { debugLog } from "../lib/log";
import { info, warn } from "../lib/logger";
import { generateErrorExtensionMessage, validateExtensionEntry } from "../utils";
import { t } from "../i18n/index";

export class OverrideModal extends Modal {
  plugin: AttachmentManagementPlugin;
  file: TAbstractFile;
  setting: AttachmentPathSettings;

  constructor(plugin: AttachmentManagementPlugin, file: TAbstractFile, setting: AttachmentPathSettings) {
    super(plugin.app);
    this.plugin = plugin;
    this.file = file;
    this.setting = setting;

    // `extensionOverride` is an array, so the shallow copy the caller makes
    // (`Object.assign({}, setting)`) still shares it with the source object. Left
    // alone, every edit in this dialog would write straight into the source list —
    // the global setting when the target had no override yet — and 移除本条目覆盖
    // could not undo it. Cloning the entries detaches this dialog from that list.
    if (setting.extensionOverride !== undefined) {
      setting.extensionOverride = setting.extensionOverride.map((ext) => ({ ...ext }));
    }
  }

  displaySw(cont: HTMLElement): void {
    cont.findAll(".setting-item").forEach((el: HTMLElement) => {
      if (el.getAttr("class")?.includes("override_root_folder_set")) {
        if (this.setting.saveAttE === "obsFolder") {
          el.hide();
        } else {
          el.show();
        }
      }
    });
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    const isFolder = this.file instanceof TFolder;

    info("ui:override", "override modal open", {
      target: this.file.path,
      targetType: isFolder ? "folder" : "file",
      settingType: this.setting.type,
      saveAttE: this.setting.saveAttE,
      attachmentRoot: this.setting.attachmentRoot,
      attachmentPath: this.setting.attachmentPath,
      attachFormat: this.setting.attachFormat,
      extOverrideCount: this.setting.extensionOverride?.length ?? 0,
    });

    contentEl.createEl("h3", {
      text: t("override.title", { path: this.file.path }),
    });

    renderOrderLegend(contentEl, isFolder ? "folder" : "file");

    const layer = createLayerBox(contentEl, isFolder ? t("layer.folder") : t("layer.file"));

    new Setting(layer)
      .setName(t("settings.rootPath.name"))
      .setDesc(t("settings.rootPath.desc"))
      .addDropdown((text) =>
        text
          .addOption(`${SETTINGS_ROOT_OBSFOLDER}`, t("settings.rootPath.options.obsidian"))
          .addOption(`${SETTINGS_ROOT_INFOLDER}`, t("settings.rootPath.options.inFolder"))
          .addOption(`${SETTINGS_ROOT_NEXTTONOTE}`, t("settings.rootPath.options.nextToNote"))
          .setValue(this.setting.saveAttE)
          .onChange(async (value) => {
            this.setting.saveAttE = value;
            this.displaySw(contentEl);
          }),
      );

    new Setting(layer)
      .setName(t("settings.rootFolder.name"))
      .setDesc(t("settings.rootFolder.desc"))
      .setClass("override_root_folder_set")
      .addText((text) => {
        attachFolderSuggest(this.plugin.app, text.inputEl, (picked) => {
          this.setting.attachmentRoot = picked;
        });
        text
          .setPlaceholder(DEFAULT_SETTINGS.attachPath.attachmentRoot)
          .setValue(this.setting.attachmentRoot)
          .onChange(async (value) => {
            debugLog("override - attachment root:" + value);
            this.setting.attachmentRoot = value;
          });
      });

    new Setting(layer)
      .setName(t("settings.attachmentPath.name"))
      .setDesc(t("settings.attachmentPath.desc"))
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.attachPath.attachmentPath)
          .setValue(this.setting.attachmentPath)
          .onChange(async (value) => {
            debugLog("override - attachment path:" + value);
            this.setting.attachmentPath = value;
          }),
      );

    new Setting(layer)
      .setName(t("settings.attachmentFormat.name"))
      .setDesc(t("settings.attachmentFormat.desc"))
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.attachPath.attachFormat)
          .setValue(this.setting.attachFormat)
          .onChange(async (value: string) => {
            debugLog("override - attachment format:" + value);
            this.setting.attachFormat = value;
          }),
      );

    const exceptionArea = renderExceptionArea(layer, {
      plugin: this.plugin,
      layer: this.setting,
      scope: isFolder ? "folder" : "file",
      // This dialog edits a working copy; it reaches the vault only on 确认.
      persist: async () => undefined,
    });

    new Setting(contentEl)
      .addButton((btn) => {
        btn.setButtonText(t("override.buttons.reset")).onClick(async () => {
          const hadExactKey = this.plugin.settings.overridePath[this.file.path] !== undefined;
          this.setting = this.plugin.settings.attachPath;
          delete this.plugin.settings.overridePath[this.file.path];
          await this.plugin.saveSettings();
          await this.plugin.loadSettings();
          info("ui:override", "override reset from modal", {
            target: this.file.path,
            hadExactKey: hadExactKey,
            keysAfter: Object.keys(this.plugin.settings.overridePath),
          });
          new Notice(t("override.notifications.reset", { path: this.file.path }));
          this.close();
        });
      })
      .addButton((btn) =>
        btn
          .setButtonText(t("override.buttons.submit"))
          .setCta()
          .onClick(async () => {
            // The exception editor only marks a bad entry; this dialog still writes the
            // whole layer on 确认, so re-check here or an excluded extension would be saved.
            const invalidEntry = validateExtensionEntry(this.setting, this.plugin.settings)[0];
            if (invalidEntry !== undefined) {
              warn("ui:override", "override submit blocked", {
                target: this.file.path,
                reason: "invalid_exception",
                errorType: invalidEntry.type,
                entryIndex: invalidEntry.index,
              });
              generateErrorExtensionMessage(invalidEntry.type);
              return;
            }
            // Rejected text is never written into the layer, so the check above cannot see it.
            // Without this the dialog would close and silently drop the extension just typed.
            if (exceptionArea.hasRejectedInput()) {
              warn("ui:override", "override submit blocked", {
                target: this.file.path,
                reason: "rejected_exception_input",
              });
              new Notice(t("errors.exceptionRejected"));
              return;
            }
            if (this.file instanceof TFile) {
              this.setting.type = SETTINGS_TYPES.FILE;
            } else if (this.file instanceof TFolder) {
              this.setting.type = SETTINGS_TYPES.FOLDER;
            }
            const keysBefore = Object.keys(this.plugin.settings.overridePath);
            this.plugin.settings.overridePath[this.file.path] = this.setting;
            await this.plugin.saveSettings();
            info("ui:override", "override submitted", {
              target: this.file.path,
              settingType: this.setting.type,
              saveAttE: this.setting.saveAttE,
              attachmentRoot: this.setting.attachmentRoot,
              attachmentPath: this.setting.attachmentPath,
              attachFormat: this.setting.attachFormat,
              extOverrideCount: this.setting.extensionOverride?.length ?? 0,
              keysBefore: keysBefore,
              keysAfter: Object.keys(this.plugin.settings.overridePath),
            });
            debugLog("override - overriding settings:", this.file.path, this.setting);
            new Notice(t("override.notifications.overridden", { path: this.file.path }));
            this.close();
          }),
      );

    this.displaySw(contentEl);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
