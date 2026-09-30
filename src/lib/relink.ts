import { App, MarkdownView, TFile } from "obsidian";
import { planLinkRewrite } from "./embed";
import { error, trace } from "./logger";

/**
 * Rewrite the single occurrence of `oldLink` in `note` into `newLink`.
 *
 * The active markdown note goes through the editor so the cursor is preserved and the
 * file is not reloaded; canvas and background notes fall back to `adapter.process`.
 * Only one occurrence is touched, which is what lets the rearrange split point each
 * referencing note at its own copy instead of rewriting links vault-wide.
 *
 * @param subsystem log subsystem tag, so the caller's context is visible in the log
 */
export function updateLinkInNote(app: App, note: TFile, oldLink: string, newLink: string, subsystem: string): void {
  if (oldLink === newLink) {
    trace(subsystem, "link unchanged, nothing to update", { note: note.path, link: oldLink });
    return;
  }

  const mdView = app.workspace.getActiveViewOfType(MarkdownView);
  if (mdView && mdView.file && mdView.file.path === note.path && mdView.editor) {
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
      trace(subsystem, "link updated via editor API", {
        note: note.path,
        from: oldLink,
        to: newLink,
        annotationPreserved: plan.annotationPreserved,
      });
      return;
    }
  }

  app.vault.adapter
    .process(note.path, (data) => {
      // Recompute against the on-disk content: offsets from the editor are stale here.
      const plan = planLinkRewrite(data, oldLink, newLink);
      if (plan === null) {
        return data;
      }
      trace(subsystem, "link updated via adapter.process", {
        note: note.path,
        from: oldLink,
        to: newLink,
        annotationPreserved: plan.annotationPreserved,
      });
      return data.substring(0, plan.from) + plan.text + data.substring(plan.to);
    })
    .catch((err) => {
      // The attachment moved but the link still points at the old path, i.e. the note
      // is now broken. Nothing else reports this.
      error(subsystem, "link update via adapter.process failed", {
        note: note.path,
        from: oldLink,
        to: newLink,
        err: err,
      });
    });
}
