import { Modal, Notice, Setting, setIcon } from "obsidian";
import AttachmentManagementPlugin from "../main";
import { ArrangeHandler, arrangeResultNotice, RearrangeType } from "../arrange";
import { error, info } from "../lib/logger";
import { t } from "../i18n/index";

export class ConfirmModal extends Modal {
  plugin: AttachmentManagementPlugin;

  constructor(plugin: AttachmentManagementPlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createDiv({ cls: "amg-confirm-header" });

    const iconEl = header.createSpan({ cls: "amg-confirm-icon" });
    setIcon(iconEl, "alert-triangle");

    header.createEl("h3", {
      text: t("confirm.title"),
      cls: "amg-confirm-title",
    });

    contentEl.createEl("p", {
      text: t("confirm.message"),
      cls: "amg-confirm-message",
    });

    new Setting(contentEl)
      .addButton((btn) => {
        btn.setButtonText(t("common.cancel")).onClick(() => {
          this.close();
        });
      })
      .addButton((btn) =>
        btn
          .setButtonText(t("confirm.continue"))
          .setWarning()
          .onClick(() => {
            info("ui:confirm", "rearrange all links confirmed", {
              autoRenameAttachment: this.plugin.settings.autoRenameAttachment,
            });
            new ArrangeHandler(this.plugin.settings, this.plugin.app)
              .rearrangeAttachment(RearrangeType.LINKS)
              .then((result) => new Notice(arrangeResultNotice(result)))
              .catch((err) => {
                error("ui:confirm", "rearrange all links failed", { err: err });
                new Notice(`${t("notices.error.unknownError")}: ${err instanceof Error ? err.message : String(err)}`);
              })
              .finally(() => this.close());
          }),
      );
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
