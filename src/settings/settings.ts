import {
  App,
  MomentFormatComponent,
  Notice,
  PluginSettingTab,
  requireApiVersion,
  Setting,
  SettingDefinition,
  SettingDefinitionItem,
  SettingGroupItem,
  TextAreaComponent,
} from "obsidian";
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

/**
 * One row of the settings tab, described once and rendered by both paths: the imperative
 * `display()` before Obsidian 1.13, and the declarative definitions from 1.13 on.
 */
interface SettingRow {
  name: string;
  /** A factory, so a re-render gets a fresh DocumentFragment rather than a consumed one. */
  desc?: string | (() => DocumentFragment);
  build: (setting: Setting) => void;
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
    // From 1.13 on the tab renders from getSettingDefinitions(), so building the same
    // content here as well would show every row twice.
    if (requireApiVersion("1.13.0")) {
      return;
    }

    const { containerEl } = this;

    containerEl.empty();

    this.heading(new Setting(containerEl), t("settings.title"));
    renderOrderLegend(containerEl, "global");

    const layer = createLayerBox(containerEl, t("layer.global"));
    for (const row of this.layerRows()) {
      this.applyRow(new Setting(layer), row);
    }
    renderExceptionArea(layer, this.exceptionAreaOptions());

    this.heading(new Setting(containerEl), t("settings.others"));
    for (const row of this.otherRows()) {
      this.applyRow(new Setting(containerEl), row);
    }

    this.heading(new Setting(containerEl), t("settings.overrideList.name"));
    const overrides = this.overrideRows();
    if (overrides.empty !== undefined) {
      containerEl.createEl("p", { text: overrides.empty, cls: "attach_management_override_empty" });
    }
    for (const row of overrides.rows) {
      this.applyRow(new Setting(containerEl), row);
    }

    this.heading(new Setting(containerEl), t("settings.diagnostics.name"));
    this.applyRow(new Setting(containerEl), this.debugLogRow());

    this.displaySw(containerEl);
  }

  /**
   * The declarative counterpart of `display()`. Every section is its own explicit group:
   * the renderer sweeps consecutive non-group definitions into one implicit group, which
   * would draw several sections as a single shared card, and only an explicit group can
   * carry a class for `styles.css` to key off. The section title is the group's heading, so
   * it shares the rows' left baseline; the layer keeps its own group so the exceptions stay
   * bound to the four fields they modify. Every row reuses the builder the imperative path
   * calls, so the two renders cannot drift apart.
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      this.sectionDef(t("settings.title"), [
        this.rawDef((setting) => {
          renderOrderLegend(setting.settingEl, "global");
        }),
      ]),
      this.sectionDef(
        t("layer.global"),
        [
          ...this.layerRows().map((row) => this.rowDef(row)),
          this.rawDef((setting) => {
            renderExceptionArea(setting.settingEl, this.exceptionAreaOptions());
          }),
        ],
        "attach_management_layer",
      ),
      this.sectionDef(
        t("settings.others"),
        this.otherRows().map((row) => this.rowDef(row)),
      ),
      this.sectionDef(t("settings.overrideList.name"), this.overrideDefs()),
      this.sectionDef(t("settings.diagnostics.name"), [this.rowDef(this.debugLogRow())]),
    ];
  }

  /** One section: an explicit group whose heading doubles as the section title. */
  private sectionDef(heading: string, items: SettingGroupItem<string>[], extraCls?: string): SettingDefinitionItem {
    const cls = extraCls === undefined ? "attach_management_section" : `attach_management_section ${extraCls}`;
    return { type: "group", heading, cls, items };
  }

  /** A section heading: a Setting in heading mode is what both paths end up on. */
  private heading(setting: Setting, name: string): void {
    setting.setName(name).setClass("attach_management_tab_heading").setHeading();
  }

  /** A definition whose content is whatever `build` writes into the row element. */
  private rawDef(build: (setting: Setting) => void): SettingDefinition {
    return {
      name: "",
      searchable: false,
      render: (setting) => {
        setting.settingEl.addClass("attach_management_raw_row");
        build(setting);
      },
    };
  }

  private rowDef(row: SettingRow): SettingDefinition {
    const render = (setting: Setting): void => {
      this.applyRow(setting, row);
    };
    // Only a plain string can be handed to the framework, and that is what puts the row into
    // Obsidian's settings search. A fragment is left to `render`: the renderer may consume
    // the definition's copy, which would leave the row's description empty on a re-render.
    if (typeof row.desc === "string") {
      return { name: row.name, desc: row.desc, render };
    }
    return { name: row.name, searchable: false, render };
  }

  private applyRow(setting: Setting, row: SettingRow): void {
    setting.setName(row.name);
    const desc = typeof row.desc === "function" ? row.desc() : row.desc;
    if (desc !== undefined) {
      setting.setDesc(desc);
    }
    row.build(setting);
  }

  private exceptionAreaOptions() {
    return {
      plugin: this.plugin,
      layer: this.plugin.settings.attachPath,
      scope: "global" as const,
      persist: async () => {
        await this.plugin.saveSettings();
      },
    };
  }

  /** The four field rows a layer owns, in the order the resolution is explained. */
  private layerRows(): SettingRow[] {
    return [
      {
        name: t("settings.rootPath.name"),
        desc: t("settings.rootPath.desc"),
        build: (setting) => {
          this.buildRootPath(setting);
        },
      },
      {
        name: t("settings.rootFolder.name"),
        desc: t("settings.rootFolder.desc"),
        build: (setting) => {
          this.buildRootFolder(setting);
        },
      },
      {
        name: t("settings.attachmentPath.name"),
        desc: t("settings.attachmentPath.desc"),
        build: (setting) => {
          this.buildAttachmentPath(setting);
        },
      },
      {
        name: t("settings.attachmentFormat.name"),
        desc: t("settings.attachmentFormat.desc"),
        build: (setting) => {
          this.buildAttachmentFormat(setting);
        },
      },
    ];
  }

  private otherRows(): SettingRow[] {
    return [
      {
        name: t("settings.dateFormat.name"),
        desc: () => this.dateFormatDesc(),
        build: (setting) => {
          this.buildDateFormat(setting);
        },
      },
      {
        name: t("settings.autoRename.name"),
        desc: t("settings.autoRename.desc"),
        build: (setting) => {
          this.buildAutoRename(setting);
        },
      },
      {
        name: t("settings.excludeExtension.name"),
        desc: t("settings.excludeExtension.desc"),
        build: (setting) => {
          this.buildExcludeExtension(setting);
        },
      },
      {
        name: t("settings.excludedPaths.name"),
        desc: t("settings.excludedPaths.desc"),
        build: (setting) => {
          this.buildExcludedPaths(setting);
        },
      },
      {
        name: t("settings.excludeSubpaths.name"),
        desc: t("settings.excludeSubpaths.desc"),
        build: (setting) => {
          this.buildExcludeSubpaths(setting);
        },
      },
    ];
  }

  private debugLogRow(): SettingRow {
    return {
      name: t("settings.diagnostics.enable.name"),
      desc: t("settings.diagnostics.enable.desc", { path: getLogPath() }),
      build: (setting) => {
        this.buildDebugLog(setting);
      },
    };
  }

  /**
   * The layer box above is the global layer, so cross-layer overrides are otherwise
   * invisible from here. Two of them are dead without ever raising an error — the target is
   * gone, or the stored type no longer fits what is at that path — so both are called out
   * per row rather than only in the log.
   */
  private overrideRows(): { empty?: string; rows: SettingRow[] } {
    const audit = auditOverrideKeys(this.app, this.plugin.settings);
    const stale = new Set(audit.stale);
    const mismatched = new Set(audit.mismatched);
    const keys = Object.keys(this.plugin.settings.overridePath).sort();
    if (keys.length === 0) {
      return { empty: t("settings.overrideList.empty"), rows: [] };
    }
    return {
      rows: keys.map((key) => ({
        name: key,
        desc: () => this.overrideDesc(key, stale, mismatched),
        build: (setting) => {
          this.buildOverrideRemove(setting, key);
        },
      })),
    };
  }

  private overrideDefs(): SettingDefinition[] {
    const { empty, rows } = this.overrideRows();
    if (empty !== undefined) {
      return [
        this.rawDef((setting) => {
          setting.settingEl.createEl("p", { text: empty, cls: "attach_management_override_empty" });
        }),
      ];
    }
    return rows.map((row) => this.rowDef(row));
  }

  private overrideDesc(key: string, stale: Set<string>, mismatched: Set<string>): DocumentFragment {
    const override = this.plugin.settings.overridePath[key];
    const isFileOverride = override.type === SETTINGS_TYPES.FILE;
    const typeLabel = isFileOverride ? t("settings.overrideList.typeFile") : t("settings.overrideList.typeFolder");

    let status: string;
    let isDead = false;
    if (stale.has(key)) {
      status = t("settings.overrideList.statusMissing");
      isDead = true;
    } else if (mismatched.has(key)) {
      status = t("settings.overrideList.statusMismatch", {
        actual: isFileOverride ? t("settings.overrideList.kindFolder") : t("settings.overrideList.kindFile"),
      });
      isDead = true;
    } else {
      status = t("settings.overrideList.statusOk");
    }

    return createFragment((frag) => {
      frag.appendText(t("settings.overrideList.overview", { type: typeLabel }));
      frag.createSpan({
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
    });
  }

  private buildRootPath(setting: Setting): void {
    setting.addDropdown((text) =>
      text
        .addOption(`${SETTINGS_ROOT_OBSFOLDER}`, t("settings.rootPath.options.obsidian"))
        .addOption(`${SETTINGS_ROOT_INFOLDER}`, t("settings.rootPath.options.inFolder"))
        .addOption(`${SETTINGS_ROOT_NEXTTONOTE}`, t("settings.rootPath.options.nextToNote"))
        .setValue(this.plugin.settings.attachPath.saveAttE)
        .onChange(async (value) => {
          this.plugin.settings.attachPath.saveAttE = value;
          this.displaySw(this.containerEl);
          await this.plugin.saveSettings();
        }),
    );
  }

  private buildRootFolder(setting: Setting): void {
    setting.setClass("root_folder_set").addText((text) => {
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
    // The row exists by now, so this is also what applies the initial hide/show.
    this.displaySw(this.containerEl);
  }

  private buildAttachmentPath(setting: Setting): void {
    setting.addText((text) => {
      const controlEl = text.inputEl.parentElement!;
      const errEl = controlEl.createDiv({ cls: "setting-item-description amg-setting-error" });
      controlEl.insertBefore(errEl, text.inputEl);
      errEl.hide();

      const applyValidation = (value: string): boolean => {
        const err = validateAttachmentPath(value);
        if (err) {
          text.inputEl.addClass("amg-input-invalid");
          errEl.setText(attachmentPathErrorMessage(err));
          errEl.show();
          return false;
        }
        text.inputEl.removeClass("amg-input-invalid");
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
  }

  private buildAttachmentFormat(setting: Setting): void {
    setting.addText((text) => {
      const controlEl = text.inputEl.parentElement!;
      const errEl = controlEl.createDiv({ cls: "setting-item-description amg-setting-error" });
      controlEl.insertBefore(errEl, text.inputEl);
      errEl.hide();

      const applyValidation = (value: string): boolean => {
        const err = validateAttachFormat(value);
        if (err) {
          text.inputEl.addClass("amg-input-invalid");
          errEl.setText(attachFormatErrorMessage(err));
          errEl.show();
          return false;
        }
        text.inputEl.removeClass("amg-input-invalid");
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
  }

  private dateFormatDesc(): DocumentFragment {
    return createFragment((frag) => {
      frag.appendText(t("settings.dateFormat.desc") + " ");
      frag.createEl("a", {
        href: "https://momentjscom.readthedocs.io/en/latest/moment/04-displaying/01-format",
        text: t("settings.dateFormat.linkText"),
      });
    });
  }

  private buildDateFormat(setting: Setting): void {
    setting.addMomentFormat((component: MomentFormatComponent) => {
      component
        .setPlaceholder(DEFAULT_SETTINGS.dateFormat)
        .setValue(this.plugin.settings.dateFormat)
        .onChange(async (value) => {
          debugLog("setting - date format:" + value);
          this.plugin.settings.dateFormat = value;
          await this.plugin.saveSettings();
        });
    });
  }

  private buildAutoRename(setting: Setting): void {
    setting.addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.autoRenameAttachment).onChange(async (value) => {
        debugLog("setting - automatically rename attachment folder:" + value);
        this.plugin.settings.autoRenameAttachment = value;
        await this.plugin.saveSettings();
      }),
    );
  }

  private buildExcludeExtension(setting: Setting): void {
    setting.addText((text) =>
      text
        .setPlaceholder(t("settings.excludeExtension.placeholder"))
        .setValue(this.plugin.settings.excludeExtensionPattern)
        .onChange(async (value) => {
          this.plugin.settings.excludeExtensionPattern = value;
          await this.plugin.saveSettings();
        }),
    );
  }

  private buildExcludedPaths(setting: Setting): void {
    setting.addTextArea((component: TextAreaComponent) => {
      component.setValue(this.plugin.settings.excludedPaths).onChange(async (value) => {
        this.plugin.settings.excludedPaths = value;
        const { splittedPaths } = this.splitPath(value);
        this.plugin.settings.excludePathsArray = splittedPaths;
        debugLog("setting - excluded paths:" + value, splittedPaths);
        await this.plugin.saveSettings();
      });
    });
  }

  private buildExcludeSubpaths(setting: Setting): void {
    setting.setClass("attach_management_setting_indent").addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.excludeSubpaths).onChange(async (value) => {
        debugLog("setting - excluded subpaths:" + value);
        this.plugin.settings.excludeSubpaths = value;
        await this.plugin.saveSettings();
      }),
    );
  }

  private buildDebugLog(setting: Setting): void {
    setting.addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.debugLogEnabled).onChange(async (value) => {
        this.plugin.settings.debugLogEnabled = value;
        setLogEnabled(value);
        info("ui:settings", "diagnostic log toggled", { debugLogEnabled: value, logPath: getLogPath() });
        await this.plugin.saveSettings();
      }),
    );
  }

  private buildOverrideRemove(setting: Setting, key: string): void {
    setting.addButton((button) =>
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
          this.refreshAfterOverrideRemoval();
        }),
    );
  }

  /**
   * The list is rebuilt from scratch after a removal. `display()` is the only redraw hook
   * before 1.13; from 1.13 on it is skipped, and `update()` re-runs the definitions instead.
   */
  private refreshAfterOverrideRemoval(): void {
    if (requireApiVersion("1.13.0")) {
      this.update();
    } else {
      this.display();
    }
  }
}
