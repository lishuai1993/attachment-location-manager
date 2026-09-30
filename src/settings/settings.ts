import { App, MomentFormatComponent, Notice, PluginSettingTab, Setting, TextAreaComponent } from "obsidian";
import AttachmentManagementPlugin from "../main";
import {
  SETTINGS_ROOT_OBSFOLDER,
  SETTINGS_VARIABLES_NOTEPATH,
  SETTINGS_VARIABLES_NOTENAME,
  SETTINGS_VARIABLES_DATES,
  SETTINGS_ROOT_INFOLDER,
  SETTINGS_ROOT_NEXTTONOTE,
} from "../lib/constant";
import { createLayerBox, renderExceptionArea, renderOrderLegend } from "./exceptionArea";
import { auditOverrideKeys } from "../override";
import {
  validateAttachFormat,
  attachFormatErrorMessage,
  validateAttachmentPath,
  attachmentPathErrorMessage,
} from "../utils";
import { attachFolderSuggest } from "../lib/folderSuggest";
import { debugLog } from "../lib/log";
import { getLogPath, info, setLogEnabled } from "../lib/logger";
import { t } from "../i18n/index";

export enum SETTINGS_TYPES {
  GLOBAL = "GLOBAL",
  FOLDER = "FOLDER",
  FILE = "FILE",
}

export interface AttachmentPathSettings {
  // Attachment root path
  attachmentRoot: string;
  // How to save attachment, in fixed folder, current folder or subfolder in current folder
  saveAttE: string;
  // Attachment path
  attachmentPath: string;
  // How to renamed the attachment file
  attachFormat: string;
  // Override type
  type: SETTINGS_TYPES;
  // Extension override
  extensionOverride?: ExtensionOverrideSettings[];
}

export interface OriginalNameStorage {
  // Original name
  n: string;
  // Current name
  md5: string;
}

export interface ExtensionOverrideSettings {
  // Extension
  extension: string;
  // The four fields below are a delta on top of the owning layer: absent means
  // "inherit this layer", present (even as an empty string) means "explicit value".
  // Attachment root path
  attachmentRoot?: string;
  // How to save attachment, in fixed folder, current folder or subfolder in current folder
  saveAttE?: string;
  // Attachment path
  attachmentPath?: string;
  // How to renamed the attachment file
  attachFormat?: string;
}

export interface AttachmentManagementPluginSettings {
  // Disable notification
  disableNotification: boolean;
  // Write INFO/TRACE diagnostic entries to the log file
  debugLogEnabled: boolean;
  // Path
  attachPath: AttachmentPathSettings;
  // Date format
  dateFormat: string;
  // Exclude extension not to rename
  excludeExtensionPattern: string;
  // Auto-rename attachment folder or filename and update the link
  autoRenameAttachment: boolean;
  // Exclude path not to rename
  excludedPaths: string;
  // Exclude path array
  excludePathsArray: string[];
  // Exclude subpath also
  excludeSubpaths: boolean;
  // Presistence storage of original name
  originalNameStorage: OriginalNameStorage[];
  // Path of notes that override global configuration
  overridePath: Record<string, AttachmentPathSettings>;
}

export const DEFAULT_SETTINGS: AttachmentManagementPluginSettings = {
  debugLogEnabled: false,
  attachPath: {
    attachmentRoot: "",
    saveAttE: `${SETTINGS_ROOT_OBSFOLDER}`,
    attachmentPath: `${SETTINGS_VARIABLES_NOTEPATH}/${SETTINGS_VARIABLES_NOTENAME}`,
    attachFormat: `IMG-${SETTINGS_VARIABLES_DATES}`,
    type: SETTINGS_TYPES.GLOBAL,
  },
  dateFormat: "YYYYMMDDHHmmssSSS",
  excludeExtensionPattern: "",
  autoRenameAttachment: true,
  excludedPaths: "",
  excludePathsArray: [],
  excludeSubpaths: false,
  originalNameStorage: [],
  overridePath: {},
  disableNotification: false,
};

/** An unset field shows a placeholder; a blank value used to leave a dangling label. */
function shownValue(value: string): string {
  return value === "" ? t("settings.overrideList.valueEmpty") : value;
}

/** The three root-path modes have their own labels; a value outside them is shown raw. */
function rootModeLabel(saveAttE: string): string {
  switch (saveAttE) {
    case SETTINGS_ROOT_OBSFOLDER:
      return t("settings.rootPath.options.obsidian");
    case SETTINGS_ROOT_INFOLDER:
      return t("settings.rootPath.options.inFolder");
    case SETTINGS_ROOT_NEXTTONOTE:
      return t("settings.rootPath.options.nextToNote");
    default:
      return saveAttE;
  }
}

export class AttachmentManagementSettingTab extends PluginSettingTab {
  plugin: AttachmentManagementPlugin;

  constructor(app: App, plugin: AttachmentManagementPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  displaySw(cont: HTMLElement): void {
    cont.findAll(".setting-item").forEach((el: HTMLElement) => {
      if (el.getAttr("class")?.includes("root_folder_set")) {
        if (this.plugin.settings.attachPath.saveAttE === "obsFolder") {
          el.hide();
        } else {
          el.show();
        }
      }
    });
  }

  splitPath(path: string): { splittedPaths: string[] } {
    const splitted = path.split(";");
    const rets = [];
    for (const s of splitted) {
      rets.push(s.trim());
    }
    return { splittedPaths: rets };
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    containerEl.createEl("h2", { text: t("settings.title"), cls: "attach_management_tab_heading" });
    renderOrderLegend(containerEl, "global");

    const layer = createLayerBox(containerEl, t("layer.global"));

    // new Setting(containerEl).setName("Disable notification").addToggle((toggle) => {
    //     toggle.setValue(this.plugin.settings.disableNotification).onChange(async (value) => {
    //         this.plugin.settings.disableNotification = value;
    //         await this.plugin.saveSettings();
    //     });
    // });

    new Setting(layer)
      .setName(t("settings.rootPath.name"))
      .setDesc(t("settings.rootPath.desc"))
      .addDropdown((text) =>
        text
          .addOption(`${SETTINGS_ROOT_OBSFOLDER}`, t("settings.rootPath.options.obsidian"))
          .addOption(`${SETTINGS_ROOT_INFOLDER}`, t("settings.rootPath.options.inFolder"))
          .addOption(`${SETTINGS_ROOT_NEXTTONOTE}`, t("settings.rootPath.options.nextToNote"))
          .setValue(this.plugin.settings.attachPath.saveAttE)
          .onChange(async (value) => {
            this.plugin.settings.attachPath.saveAttE = value;
            this.displaySw(containerEl);
            await this.plugin.saveSettings();
          }),
      );

    new Setting(layer)
      .setName(t("settings.rootFolder.name"))
      .setDesc(t("settings.rootFolder.desc"))
      .setClass("root_folder_set")
      .addText((text) => {
        attachFolderSuggest(this.app, text.inputEl, (picked) => {
          text.setValue(picked);
          this.plugin.settings.attachPath.attachmentRoot = picked;
          void this.plugin.saveSettings();
        });
        text
          .setPlaceholder(DEFAULT_SETTINGS.attachPath.attachmentRoot)
          .setValue(this.plugin.settings.attachPath.attachmentRoot)
          .onChange(async (value) => {
            debugLog("setting - attachment root:" + value);
            this.plugin.settings.attachPath.attachmentRoot = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(layer)
      .setName(t("settings.attachmentPath.name"))
      .setDesc(t("settings.attachmentPath.desc"))
      .addText((text) => {
        const controlEl = text.inputEl.parentElement!;
        const errEl = controlEl.createDiv({ cls: "setting-item-description" });
        controlEl.insertBefore(errEl, text.inputEl);
        errEl.style.color = "var(--color-red)";
        errEl.style.marginRight = "8px";
        errEl.style.textAlign = "right";
        errEl.hide();

        const applyValidation = (value: string): boolean => {
          const err = validateAttachmentPath(value);
          if (err) {
            text.inputEl.style.border = "1px solid var(--color-red)";
            errEl.setText(attachmentPathErrorMessage(err));
            errEl.show();
            return false;
          }
          text.inputEl.style.border = "";
          errEl.hide();
          return true;
        };

        text
          .setPlaceholder(DEFAULT_SETTINGS.attachPath.attachmentPath)
          .setValue(this.plugin.settings.attachPath.attachmentPath)
          .onChange(async (value) => {
            debugLog("setting - attachment path:" + value);
            if (!applyValidation(value)) return;
            this.plugin.settings.attachPath.attachmentPath = value;
            await this.plugin.saveSettings();
          });

        applyValidation(this.plugin.settings.attachPath.attachmentPath);
      });

    new Setting(layer)
      .setName(t("settings.attachmentFormat.name"))
      .setDesc(t("settings.attachmentFormat.desc"))
      .addText((text) => {
        const controlEl = text.inputEl.parentElement!;
        const errEl = controlEl.createDiv({ cls: "setting-item-description" });
        controlEl.insertBefore(errEl, text.inputEl);
        errEl.style.color = "var(--color-red)";
        errEl.style.marginRight = "8px";
        errEl.style.textAlign = "right";
        errEl.hide();

        const applyValidation = (value: string): boolean => {
          const err = validateAttachFormat(value);
          if (err) {
            text.inputEl.style.border = "1px solid var(--color-red)";
            errEl.setText(attachFormatErrorMessage(err));
            errEl.show();
            return false;
          }
          text.inputEl.style.border = "";
          errEl.hide();
          return true;
        };

        text
          .setPlaceholder(DEFAULT_SETTINGS.attachPath.attachFormat)
          .setValue(this.plugin.settings.attachPath.attachFormat)
          .onChange(async (value) => {
            debugLog("setting - attachment format:" + value);
            if (!applyValidation(value)) return;
            this.plugin.settings.attachPath.attachFormat = value;
            await this.plugin.saveSettings();
          });

        applyValidation(this.plugin.settings.attachPath.attachFormat);
      });

    renderExceptionArea(layer, {
      plugin: this.plugin,
      layer: this.plugin.settings.attachPath,
      scope: "global",
      persist: async () => {
        await this.plugin.saveSettings();
      },
    });

    containerEl.createEl("h3", { text: t("settings.others"), cls: "attach_management_tab_heading" });

    new Setting(containerEl)
      .setName(t("settings.dateFormat.name"))
      .setDesc(
        createFragment((frag) => {
          frag.appendText(t("settings.dateFormat.desc") + " ");
          frag.createEl("a", {
            href: "https://momentjscom.readthedocs.io/en/latest/moment/04-displaying/01-format",
            text: t("settings.dateFormat.linkText"),
          });
        }),
      )
      .addMomentFormat((component: MomentFormatComponent) => {
        component
          .setPlaceholder(DEFAULT_SETTINGS.dateFormat)
          .setValue(this.plugin.settings.dateFormat)
          .onChange(async (value) => {
            debugLog("setting - date format:" + value);
            this.plugin.settings.dateFormat = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName(t("settings.autoRename.name"))
      .setDesc(t("settings.autoRename.desc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoRenameAttachment).onChange(async (value) => {
          debugLog("setting - automatically rename attachment folder:" + value);
          this.plugin.settings.autoRenameAttachment = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.excludeExtension.name"))
      .setDesc(t("settings.excludeExtension.desc"))
      .addText((text) =>
        text
          .setPlaceholder(t("settings.excludeExtension.placeholder"))
          .setValue(this.plugin.settings.excludeExtensionPattern)
          .onChange(async (value) => {
            this.plugin.settings.excludeExtensionPattern = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.excludedPaths.name"))
      .setDesc(t("settings.excludedPaths.desc"))
      .addTextArea((component: TextAreaComponent) => {
        component.setValue(this.plugin.settings.excludedPaths).onChange(async (value) => {
          this.plugin.settings.excludedPaths = value;
          const { splittedPaths } = this.splitPath(value);
          this.plugin.settings.excludePathsArray = splittedPaths;
          debugLog("setting - excluded paths:" + value, splittedPaths);
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setClass("attach_management_setting_indent")
      .setName(t("settings.excludeSubpaths.name"))
      .setDesc(t("settings.excludeSubpaths.desc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.excludeSubpaths).onChange(async (value) => {
          debugLog("setting - excluded subpaths:" + value);
          this.plugin.settings.excludeSubpaths = value;
          await this.plugin.saveSettings();
        }),
      );

    containerEl.createEl("h3", { text: t("settings.overrideList.name"), cls: "attach_management_tab_heading" });

    // The layer box above is the global layer, so cross-layer overrides are otherwise
    // invisible from here. Two of them are dead without ever raising an error — the
    // target is gone, or the stored type no longer fits what is at that path — so both
    // are called out per row rather than only in the log.
    const overrideAudit = auditOverrideKeys(this.app, this.plugin.settings);
    const staleKeys = new Set(overrideAudit.stale);
    const mismatchedKeys = new Set(overrideAudit.mismatched);
    const overrideKeys = Object.keys(this.plugin.settings.overridePath).sort();

    if (overrideKeys.length === 0) {
      containerEl.createEl("p", {
        text: t("settings.overrideList.empty"),
        cls: "attach_management_override_empty",
      });
    }

    for (const key of overrideKeys) {
      const override = this.plugin.settings.overridePath[key];
      const isFileOverride = override.type === SETTINGS_TYPES.FILE;
      const typeLabel = isFileOverride ? t("settings.overrideList.typeFile") : t("settings.overrideList.typeFolder");

      let status: string;
      let isDead = false;
      if (staleKeys.has(key)) {
        status = t("settings.overrideList.statusMissing");
        isDead = true;
      } else if (mismatchedKeys.has(key)) {
        status = t("settings.overrideList.statusMismatch", {
          actual: isFileOverride ? t("settings.overrideList.kindFolder") : t("settings.overrideList.kindFile"),
        });
        isDead = true;
      } else {
        status = t("settings.overrideList.statusOk");
      }

      new Setting(containerEl)
        .setName(key)
        .setDesc(
          createFragment((frag) => {
            frag.appendText(t("settings.overrideList.overview", { type: typeLabel }));
            frag.createEl("span", {
              text: status,
              cls: isDead ? "attach_management_override_dead" : "",
            });
            // One field per line: a long value then wraps inside its own line instead of
            // running into the next field's label.
            for (const line of [
              t("settings.overrideList.fieldMode", { value: rootModeLabel(override.saveAttE) }),
              t("settings.overrideList.fieldRoot", { value: shownValue(override.attachmentRoot) }),
              t("settings.overrideList.fieldPath", { value: shownValue(override.attachmentPath) }),
              t("settings.overrideList.fieldFormat", { value: shownValue(override.attachFormat) }),
            ]) {
              frag.createEl("br");
              frag.appendText(line);
            }
          }),
        )
        .addButton((button) =>
          button
            .setButtonText(t("settings.overrideList.remove"))
            .setWarning()
            .onClick(async () => {
              delete this.plugin.settings.overridePath[key];
              await this.plugin.saveSettings();
              info("ui:settings", "override removed from override list", {
                key: key,
                keysAfter: Object.keys(this.plugin.settings.overridePath),
              });
              new Notice(t("notices.overrideRemoved", { path: key }));
              this.display();
            }),
        );
    }

    containerEl.createEl("h3", { text: t("settings.diagnostics.name"), cls: "attach_management_tab_heading" });

    new Setting(containerEl)
      .setName(t("settings.diagnostics.enable.name"))
      .setDesc(t("settings.diagnostics.enable.desc", { path: getLogPath() }))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.debugLogEnabled).onChange(async (value) => {
          this.plugin.settings.debugLogEnabled = value;
          setLogEnabled(value);
          info("ui:settings", "diagnostic log toggled", { debugLogEnabled: value, logPath: getLogPath() });
          await this.plugin.saveSettings();
        }),
      );

    this.displaySw(containerEl);
  }
}
