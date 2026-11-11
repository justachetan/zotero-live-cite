/**
 * Extension entry point: wires settings, the Zotero client, the completion
 * provider, the add-entry command and the collection picker together.
 *
 * VS Code calls `activate` when a LaTeX or TeX file is first opened.
 */

import * as vscode from 'vscode';
import { BibWriter } from './bibWriter';
import { ADD_ENTRY_COMMAND, ZoteroCompletionProvider } from './completion';
import { DEFAULT_LIBRARY_URL, ZoteroClient } from './zoteroClient';

const CONFIG_SECTION = 'zoteroLiveCite';
const SELECT_COLLECTION_COMMAND = 'zoteroLiveCite.selectCollection';

/**
 * Registers the extension's provider and commands.
 *
 * @param context Extension context; everything registered is disposed with it.
 */
export function activate(context: vscode.ExtensionContext): void {
  // One client per library URL, so its collection cache survives keystrokes.
  const clients = new Map<string, ZoteroClient>();
  const clientFor = (scope: vscode.Uri | undefined): ZoteroClient => {
    const url = config(scope).get<string>('libraryUrl', DEFAULT_LIBRARY_URL).trim() || DEFAULT_LIBRARY_URL;
    let client = clients.get(url);
    if (!client) {
      client = new ZoteroClient(url);
      clients.set(url, client);
    }
    return client;
  };

  // Completion runs on every keystroke, so each distinct error is shown once
  // until a search succeeds again.
  let lastShownError: string | undefined;
  const provider = new ZoteroCompletionProvider({
    clientFor,
    collectionFor: (uri) => config(uri).get<string>('collection', '').trim(),
    onSearchError: (error) => {
      const message = errorMessage(error);
      if (message !== lastShownError) {
        lastShownError = message;
        void vscode.window.showWarningMessage(`Zotero Live Cite: ${message}`);
      }
    },
    onSearchSuccess: () => {
      lastShownError = undefined;
    },
  });

  const bibWriter = new BibWriter(context.workspaceState);

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      [{ language: 'latex' }, { language: 'tex' }],
      provider,
      '{',
      ',',
    ),
    vscode.commands.registerCommand(ADD_ENTRY_COMMAND, async (documentUri: string, citeKey: string, bibtex: string) => {
      try {
        const result = await bibWriter.add(vscode.Uri.parse(documentUri), citeKey, bibtex);
        if (result.status === 'noBibFile') {
          void vscode.window.showWarningMessage(
            `Zotero Live Cite: no .bib file to add "${citeKey}" to. Create one or set "zoteroLiveCite.bibFile".`,
          );
        } else if (result.status === 'added') {
          vscode.window.setStatusBarMessage(`Added ${citeKey} to ${vscode.workspace.asRelativePath(result.bibUri)}`, 4000);
        }
      } catch (error) {
        void vscode.window.showErrorMessage(`Zotero Live Cite: couldn't add "${citeKey}": ${errorMessage(error)}`);
      }
    }),
    vscode.commands.registerCommand(SELECT_COLLECTION_COMMAND, () => selectCollection(clientFor)),
  );
}

/** Nothing to clean up beyond `context.subscriptions`. */
export function deactivate(): void {}

/**
 * Lets the user pick the collection to search and stores it in the workspace
 * settings (user settings when no folder is open).
 *
 * @param clientFor Returns the client for the active editor's library.
 */
async function selectCollection(clientFor: (scope: vscode.Uri | undefined) => ZoteroClient): Promise<void> {
  const scope = vscode.window.activeTextEditor?.document.uri;
  let collections;
  try {
    collections = await clientFor(scope).listCollections();
  } catch (error) {
    void vscode.window.showErrorMessage(`Zotero Live Cite: ${errorMessage(error)}`);
    return;
  }
  const choices = [
    { label: '$(library) Entire library', value: '' },
    ...collections
      .map((c) => ({ label: c.path, value: c.path }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];
  const choice = await vscode.window.showQuickPick(choices, {
    placeHolder: 'Which Zotero collection should \\cite completion search? (subcollections are included)',
  });
  if (!choice) {
    return;
  }
  const target = vscode.workspace.workspaceFolders
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  await config(scope).update('collection', choice.value, target);
}

/**
 * Reads this extension's settings for a document (or globally).
 *
 * @param scope Document whose folder settings apply; `undefined` for global.
 */
function config(scope: vscode.Uri | undefined): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(CONFIG_SECTION, scope);
}

/**
 * Formats an unknown thrown value for a notification.
 *
 * @param error Anything thrown.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
