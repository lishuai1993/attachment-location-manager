import { AbstractInputSuggest, App, TFolder } from "obsidian";

/**
 * Attach vault-folder autocomplete to a text input, the way Obsidian's own
 * "Attachment folder path" setting behaves.
 */
export function attachFolderSuggest(app: App, inputEl: HTMLInputElement, onPick: (path: string) => void): void {
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
