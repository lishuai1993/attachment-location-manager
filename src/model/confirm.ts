import { Modal, Notice, Setting, setIcon } from "obsidian";
import AttachmentManagementPlugin from "../main";
import { ArrangeHandler, RearrangeType } from "../arrange";
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
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.gap = "8px";
    header.style.marginBottom = "12px";

    const iconEl = header.createSpan({ cls: "amg-confirm-icon" });
    iconEl.style.color = "var(--color-orange)";
    iconEl.style.display = "inline-flex";
    setIcon(iconEl, "alert-triangle");

    header.createEl("h3", {
      text: t("confirm.title"),
      cls: "amg-confirm-title",
    }).style.margin = "0";

    const message = contentEl.createEl("p", {
      text: t("confirm.message"),
      cls: "amg-confirm-message",
    });
    message.style.margin = "0 0 16px 0";
    message.style.lineHeight = "1.5";

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
              .then(() => new Notice(t("notices.arrangeCompleted")))
              .catch((err) => {
                error("ui:confirm", "rearrange all links failed", { err: err });
                new Notice(`${t("notices.error.unknownError")}: ${err?.message ?? err}`);
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
