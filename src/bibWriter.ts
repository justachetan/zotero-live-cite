/**
 * Appends accepted Zotero references to the project's `.bib` file.
 *
 * Runs as the command attached to every completion item (`ADD_ENTRY_COMMAND`,
 * registered in `extension.ts`), right after VS Code inserts the key.
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { bibHasKey, entryInsertion } from './bibtex';

/** Result of trying to add one entry. */
export type AddEntryResult =
  | { readonly status: 'added' | 'exists'; readonly bibUri: vscode.Uri }
  | { readonly status: 'noBibFile' };

/** Workspace-state key remembering the `.bib` picked for a folder. */
const PICKED_BIB_STATE_PREFIX = 'zoteroLiveCite.pickedBib:';

/** Folders never searched for `.bib` files. */
const EXCLUDED_FOLDERS = '**/{node_modules,build,out,.git}/**';

/**
 * Adds BibTeX entries one at a time.
 *
 * Accepting two completions in quick succession must not interleave two
 * read-then-append sequences on the same file, so calls are queued.
 */
export class BibWriter {
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * @param state Workspace state, used to remember which `.bib` the user picked
   *   when a folder has several.
   */
  constructor(private readonly state: vscode.Memento) {}

  /**
   * Appends `bibtex` to the `.bib` file for `documentUri` unless that file
   * already has an entry with `citeKey`.
   *
   * The edit goes through the editor buffer, so it respects unsaved changes:
   * the file is saved afterwards only if it had no unsaved changes before.
   *
   * @param documentUri LaTeX document the key was inserted into.
   * @param citeKey Key of the entry.
   * @param bibtex Entry exported by Zotero.
   * @returns What happened, including which file was used.
   */
  add(documentUri: vscode.Uri, citeKey: string, bibtex: string): Promise<AddEntryResult> {
    const result = this.queue.then(() => this.addNow(documentUri, citeKey, bibtex));
    this.queue = result.catch(() => undefined);
    return result;
  }

  /**
   * Unqueued body of `add`.
   *
   * @param documentUri LaTeX document the key was inserted into.
   * @param citeKey Key of the entry.
   * @param bibtex Entry exported by Zotero.
   */
  private async addNow(documentUri: vscode.Uri, citeKey: string, bibtex: string): Promise<AddEntryResult> {
    const bibUri = await this.resolveBibFile(documentUri);
    if (!bibUri) {
      return { status: 'noBibFile' };
    }
    const bib = await vscode.workspace.openTextDocument(bibUri);
    const text = bib.getText();
    if (bibHasKey(text, citeKey)) {
      return { status: 'exists', bibUri };
    }
    const wasDirty = bib.isDirty;
    const edit = new vscode.WorkspaceEdit();
    edit.insert(bibUri, bib.lineAt(bib.lineCount - 1).range.end, entryInsertion(text, bibtex));
    if (!(await vscode.workspace.applyEdit(edit))) {
      throw new Error(`Could not edit ${vscode.workspace.asRelativePath(bibUri)}.`);
    }
    if (!wasDirty) {
      await bib.save();
    }
    return { status: 'added', bibUri };
  }

  /**
   * Chooses the `.bib` file for a document, in order: the `bibFile` setting;
   * the file picked earlier for this folder; the folder's only `.bib`; or a
   * file the user picks now (remembered for next time).
   *
   * @param documentUri LaTeX document being edited.
   * @returns The `.bib` file, or `undefined` if none exists or the user
   *   dismissed the picker.
   */
  private async resolveBibFile(documentUri: vscode.Uri): Promise<vscode.Uri | undefined> {
    const folderUri = vscode.workspace.getWorkspaceFolder(documentUri)?.uri ?? vscode.Uri.joinPath(documentUri, '..');
    const configured = vscode.workspace.getConfiguration('zoteroLiveCite', documentUri).get<string>('bibFile', '').trim();
    if (configured) {
      return path.isAbsolute(configured) ? vscode.Uri.file(configured) : vscode.Uri.joinPath(folderUri, configured);
    }

    const stateKey = PICKED_BIB_STATE_PREFIX + folderUri.toString();
    const picked = this.state.get<string>(stateKey);
    if (picked && (await exists(vscode.Uri.parse(picked)))) {
      return vscode.Uri.parse(picked);
    }

    const candidates = await vscode.workspace.findFiles(new vscode.RelativePattern(folderUri, '**/*.bib'), EXCLUDED_FOLDERS);
    if (candidates.length <= 1) {
      return candidates[0];
    }
    const choice = await vscode.window.showQuickPick(
      candidates.map((uri) => ({ label: vscode.workspace.asRelativePath(uri), uri })),
      { placeHolder: 'Which .bib file should Zotero references be added to?' },
    );
    if (choice) {
      await this.state.update(stateKey, choice.uri.toString());
    }
    return choice?.uri;
  }
}

/**
 * Checks whether a file exists.
 *
 * @param uri File to check.
 */
async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
