import { Notice, Setting, TextComponent } from "obsidian";
import AttachmentManagementPlugin from "../main";
import { AttachmentPathSettings, ExtensionOverrideSettings } from "./settings";
import { SETTINGS_ROOT_INFOLDER, SETTINGS_ROOT_NEXTTONOTE, SETTINGS_ROOT_OBSFOLDER } from "../lib/constant";
import {
  attachFormatErrorMessage,
  attachmentPathErrorMessage,
  generateErrorExtensionMessage,
  validateAttachFormat,
  validateAttachmentPath,
  validateExtensionEntry,
} from "../utils";
import { attachFolderSuggest } from "../lib/folderSuggest";
import { t } from "../i18n/index";

/** Dropdown sentinel meaning "this field follows the layer that owns the exception". */
const INHERIT = "__inherit__";
const EXCEPTION_INPUT_CLASS = "attach_management_exception_input";

export type ExceptionScope = "global" | "file" | "folder";

export interface ExceptionAreaOptions {
  plugin: AttachmentManagementPlugin;
  /** The layer that owns the exception list being edited. */
  layer: AttachmentPathSettings;
  scope: ExceptionScope;
  /** Persist the settings. A no-op when the caller keeps the layer as a working copy. */
  persist: () => Promise<void>;
}

export interface ExceptionAreaHandle {
  /**
   * True while a card is showing an extension that failed validation and was therefore kept
   * out of the layer. A caller with a submit button must check this: the rejected text never
   * reaches the model, so only the area itself knows the user still has unfinished input.
   */
  hasRejectedInput: () => boolean;
}

type FieldValidator = (value: string) => string | null;

/** Visual container that binds a layer's four fields to the exceptions it owns. */
export function createLayerBox(parent: HTMLElement, title: string): HTMLElement {
  const box = parent.createDiv({ cls: "attach_management_layer" });
  box.createDiv({ cls: "attach_management_layer_title", text: title });
  return box;
}

/**
 * The whole resolution chain, with the rung the current surface edits highlighted
 * in place. Highlighting the chain itself is the point: a second "you are here"
 * line below the chain forces the reader to match two rows against each other.
 */
export function renderOrderLegend(parent: HTMLElement, active: ExceptionScope): void {
  const labels: Record<ExceptionScope, string> = {
    file: t("order.file"),
    folder: t("order.folder"),
    global: t("order.global"),
  };
  const legend = parent.createDiv({ cls: "attach_management_legend" });
  const chain = legend.createDiv({ cls: "attach_management_legend_chain" });
  chain.createSpan({ text: t("order.prefix") });
  const rungs: ExceptionScope[] = ["file", "folder", "global"];
  rungs.forEach((rung, index) => {
    if (index > 0) {
      chain.createSpan({ cls: "attach_management_legend_sep", text: t("order.separator") });
    }
    chain.createSpan({
      cls: rung === active ? "attach_management_legend_active" : "attach_management_legend_step",
      text: labels[rung],
    });
  });
}

/**
 * Render the exception area of a layer: one editable card per entry, followed by the
 * add button. Entries are edited in place, so the area rebuilds itself on structural
 * changes and never opens a modal.
 */
export function renderExceptionArea(container: HTMLElement, opts: ExceptionAreaOptions): ExceptionAreaHandle {
  const { plugin, layer, scope } = opts;
  const area = container.createDiv({ cls: "attach_management_exception_area" });

  // A just-added card has no extension yet, and an empty extension is invalid. Holding it
  // outside the layer until a valid extension is typed keeps the blank placeholder out of
  // `data.json` entirely; the add button used to persist `{extension: ""}` immediately.
  let draft: ExtensionOverrideSettings | undefined;

  /** The layer's own entries plus the not-yet-committed draft, so validation sees both. */
  const visibleEntries = (): ExtensionOverrideSettings[] => {
    const own = layer.extensionOverride ?? [];
    return draft === undefined ? own : [...own, draft];
  };

  const hitFor = (index: number) =>
    validateExtensionEntry({ ...layer, extensionOverride: visibleEntries() }, plugin.settings).find(
      (wrong) => (wrong.index < 0 ? 0 : wrong.index) === index,
    );

  // Keyed by entry object rather than index: the objects survive a rebuild, and an entry that
  // has been deleted simply stops appearing in `visibleEntries()`, so nothing needs syncing.
  const rejected = new Set<ExtensionOverrideSettings>();
  const hasRejectedInput = (): boolean => visibleEntries().some((ext) => rejected.has(ext));

  const addLabel = (): string => {
    switch (scope) {
      case "global":
        return t("exception.addGlobal");
      case "file":
        return t("exception.addFile");
      case "folder":
        return t("exception.addFolder");
    }
  };

  const inheritedText = (value: string): string =>
    t("exception.inheritValue", { value: value === "" ? t("exception.emptyValue") : value });

  const markInvalid = (inputEl: HTMLInputElement | undefined, invalid: boolean): void => {
    if (inputEl === undefined) {
      return;
    }
    inputEl.style.border = invalid ? "1px solid var(--color-red)" : "";
  };

  const addInheritableText = (
    card: HTMLElement,
    spec: {
      label: string;
      desc?: string;
      get: () => string | undefined;
      set: (value: string | undefined) => void;
      /** The owning layer's value, shown while this field is inheriting. */
      inherited: string;
      validate: FieldValidator;
      folderSuggest: boolean;
    },
  ): void => {
    let text: TextComponent | undefined;

    const syncView = (): void => {
      if (text === undefined) {
        return;
      }
      const own = spec.get();
      const custom = own !== undefined;
      text.setDisabled(!custom);
      text.setValue(custom ? own : "");
      text.setPlaceholder(custom ? "" : inheritedText(spec.inherited));
      // Surface a bad value that came from stored data, without interrupting with a notice.
      markInvalid(text.inputEl, custom && spec.validate(own) !== null);
    };

    const setting = new Setting(card).setName(spec.label);
    if (spec.desc !== undefined) {
      setting.setDesc(spec.desc);
    }

    setting
      .addToggle((toggle) =>
        toggle
          .setTooltip(t("exception.customize"))
          .setValue(spec.get() !== undefined)
          .onChange(async (enabled) => {
            spec.set(enabled ? "" : undefined);
            syncView();
            await opts.persist();
            if (!enabled || text === undefined) {
              return;
            }
            const message = spec.validate("");
            markInvalid(text.inputEl, message !== null);
            if (message !== null) {
              new Notice(message);
            }
            text.inputEl.focus();
          }),
      )
      .addText((component) => {
        text = component;
        component.setPlaceholder(inheritedText(spec.inherited)).onChange(async (value) => {
          spec.set(value);
          const message = spec.validate(value);
          markInvalid(component.inputEl, message !== null);
          if (message === null) {
            await opts.persist();
          } else {
            new Notice(message);
          }
        });
        if (spec.folderSuggest) {
          attachFolderSuggest(plugin.app, component.inputEl, (picked) => {
            component.setValue(picked);
            spec.set(picked);
            markInvalid(component.inputEl, false);
            void opts.persist();
          });
        }
        syncView();
      });
  };

  const build = (): void => {
    area.empty();

    new Setting(area)
      .setName(t("exception.section.title"))
      .setDesc(t("exception.section.desc"))
      .setClass("attach_management_exception_head");

    visibleEntries().forEach((ext, index) => {
      const card = area.createDiv({ cls: "attach_management_exception_card" });

      new Setting(card)
        .setName(t("exception.extension.name"))
        .setDesc(t("exception.extension.desc"))
        .addText((text) => {
          text.inputEl.addClass(EXCEPTION_INPUT_CLASS);
          text
            .setPlaceholder(t("exception.extension.placeholder"))
            .setValue(ext.extension)
            .onChange(async (value) => {
              const previous = ext.extension;
              ext.extension = value;
              const hit = hitFor(index);
              markInvalid(text.inputEl, hit !== undefined);
              if (hit !== undefined) {
                // Leave the rejected text on screen so typing can continue, but keep it out
                // of the model: otherwise a later save triggered by an unrelated field
                // would persist it along with that valid change.
                ext.extension = previous;
                rejected.add(ext);
                generateErrorExtensionMessage(hit.type);
                return;
              }
              rejected.delete(ext);
              // The first valid extension is what commits a draft card into the layer.
              if (draft === ext) {
                if (layer.extensionOverride === undefined) {
                  layer.extensionOverride = [];
                }
                layer.extensionOverride.push(ext);
                draft = undefined;
              }
              await opts.persist();
            });
          // An entry already in the layer can be invalid on load — stale data, or a pattern
          // narrowed after it was written. Show that, but without a notice on every render.
          if (draft !== ext) {
            markInvalid(text.inputEl, hitFor(index) !== undefined);
          }
        })
        .addExtraButton((button) =>
          button
            .setIcon("trash")
            .setTooltip(t("exception.remove"))
            .onClick(async () => {
              if (draft === ext) {
                draft = undefined;
                build();
                return;
              }
              layer.extensionOverride?.splice(index, 1);
              build();
              await opts.persist();
            }),
        );

      new Setting(card).setName(t("settings.rootPath.name")).addDropdown((dropdown) => {
        dropdown
          .addOption(INHERIT, t("exception.inherit"))
          .addOption(`${SETTINGS_ROOT_OBSFOLDER}`, t("settings.rootPath.options.obsidian"))
          .addOption(`${SETTINGS_ROOT_INFOLDER}`, t("settings.rootPath.options.inFolder"))
          .addOption(`${SETTINGS_ROOT_NEXTTONOTE}`, t("settings.rootPath.options.nextToNote"))
          .setValue(ext.saveAttE ?? INHERIT)
          .onChange(async (value) => {
            if (value === INHERIT) {
              delete ext.saveAttE;
            } else {
              ext.saveAttE = value;
            }
            await opts.persist();
          });
      });

      addInheritableText(card, {
        label: t("settings.rootFolder.name"),
        desc: t("exception.rootFolderDesc"),
        get: () => ext.attachmentRoot,
        set: (value) => {
          if (value === undefined) {
            delete ext.attachmentRoot;
          } else {
            ext.attachmentRoot = value;
          }
        },
        inherited: layer.attachmentRoot,
        validate: () => null,
        folderSuggest: true,
      });

      addInheritableText(card, {
        label: t("settings.attachmentPath.name"),
        get: () => ext.attachmentPath,
        set: (value) => {
          if (value === undefined) {
            delete ext.attachmentPath;
          } else {
            ext.attachmentPath = value;
          }
        },
        inherited: layer.attachmentPath,
        validate: (value) => {
          const err = validateAttachmentPath(value);
          return err === null ? null : attachmentPathErrorMessage(err);
        },
        folderSuggest: false,
      });

      addInheritableText(card, {
        label: t("settings.attachmentFormat.name"),
        get: () => ext.attachFormat,
        set: (value) => {
          if (value === undefined) {
            delete ext.attachFormat;
          } else {
            ext.attachFormat = value;
          }
        },
        inherited: layer.attachFormat,
        validate: (value) => {
          const err = validateAttachFormat(value);
          return err === null ? null : attachFormatErrorMessage(err);
        },
        folderSuggest: false,
      });
    });

    // The button sits after the cards, so a new entry appears above it. It only ever opens
    // an empty draft card; nothing is written until that card gets a valid extension.
    new Setting(area).addButton((button) => {
      button.setButtonText(addLabel()).onClick(() => {
        if (draft === undefined) {
          draft = { extension: "" };
          build();
        }
        const inputs = area.getElementsByClassName(EXCEPTION_INPUT_CLASS);
        const added = inputs[inputs.length - 1] as HTMLInputElement | undefined;
        added?.focus();
      });
    });
  };

  build();

  return { hasRejectedInput };
}
