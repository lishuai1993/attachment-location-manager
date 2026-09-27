import { AbstractInputSuggest, App, TFolder } from "obsidian";

/**
 * Attach vault-folder autocomplete to a text input, the way Obsidian's own
 * "Attachment folder path" setting behaves.
 *
 * `AbstractInputSuggest` is @since 1.4.10 and `manifest.json` declares no
 * `minAppVersion`, so the base class is feature-detected: on an older Obsidian the
 * input stays a plain text box instead of breaking the whole settings tab.
 */
export function attachFolderSuggest(app: App, inputEl: HTMLInputElement, onPick: (path: string) => void): void {
  if (typeof AbstractInputSuggest !== "function") {
    return;
  }

  const folderPaths = (): string[] =>
    app.vault
      .getAllLoadedFiles()
      .filter((file): file is TFolder => file instanceof TFolder)
      .map((folder) => folder.path)
      .filter((path) => path !== "" && path !== "/")
      .sort();

  class FolderSuggest extends AbstractInputSuggest<string> {
    protected getSuggestions(query: string): string[] {
      const needle = query.trim().toLowerCase();
      const all = folderPaths();
      return needle === "" ? all : all.filter((path) => path.toLowerCase().includes(needle));
    }

    renderSuggestion(value: string, el: HTMLElement): void {
      el.setText(value);
    }

    selectSuggestion(value: string): void {
      this.setValue(value);
      onPick(value);
    }
  }

  new FolderSuggest(app, inputEl);
}
