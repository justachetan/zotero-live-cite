/**
 * Completion provider that offers Zotero items inside `\cite{...}`.
 *
 *   keystroke in \cite{vaswani_at
 *        │
 *        ▼
 *   findCiteContext ── not in a cite key list ──▶ no completions
 *        │ partial key "vaswani_at"
 *        ▼
 *   ZoteroClient.search ──▶ local API (one GET per collection in scope)
 *        │ items with citeKey + bibtex
 *        ▼
 *   CompletionList(isIncomplete) ── VS Code asks again on the next keystroke
 *        │ user accepts an item
 *        ▼
 *   key inserted, then ADD_ENTRY_COMMAND appends its BibTeX (bibWriter.ts)
 *
 * Registered by `extension.ts`.
 */

import * as vscode from 'vscode';
import { findCiteContext, keyTailLength } from './citeContext';
import type { ZoteroClient, ZoteroItem } from './zoteroClient';

/** Command run after a completion is accepted; args: (documentUri, citeKey, bibtex). */
export const ADD_ENTRY_COMMAND = 'zoteroLiveCite.addEntry';

/** What the provider needs from the extension, per document. */
export interface CompletionDependencies {
  /** Client for the library configured for this document. */
  clientFor(uri: vscode.Uri): ZoteroClient;
  /** Collection configured for this document; `""` means the whole library. */
  collectionFor(uri: vscode.Uri): string;
  /** Called with any search failure other than a cancellation. */
  onSearchError(error: unknown): void;
  /** Called after a search succeeds, so a previous error can be forgotten. */
  onSearchSuccess(): void;
}

/** Offers Zotero items as citation keys inside LaTeX citation commands. */
export class ZoteroCompletionProvider implements vscode.CompletionItemProvider {
  /**
   * @param deps Settings lookup and error reporting supplied by `extension.ts`.
   */
  constructor(private readonly deps: CompletionDependencies) {}

  /**
   * Searches Zotero for the key under the cursor.
   *
   * The list is marked incomplete so VS Code calls back on every keystroke;
   * Zotero, not VS Code's local filter, decides what matches.
   *
   * @param document LaTeX document being edited.
   * @param position Cursor position.
   * @param token Cancelled when a newer keystroke supersedes this request; the
   *   HTTP requests are aborted with it.
   * @returns Zotero items, or `undefined` when the cursor is not in a citation
   *   key list or the search failed.
   */
  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.CompletionList | undefined> {
    const line = document.lineAt(position.line).text;
    const context = findCiteContext(line.slice(0, position.character));
    if (!context) {
      return undefined;
    }

    // Typing replaces the partial key; accepting mid-key replaces the whole key.
    const keyEnd = position.character + keyTailLength(line.slice(position.character));
    const range = {
      inserting: new vscode.Range(position.line, context.startCharacter, position.line, position.character),
      replacing: new vscode.Range(position.line, context.startCharacter, position.line, keyEnd),
    };

    const controller = new AbortController();
    const cancellation = token.onCancellationRequested(() => controller.abort());
    try {
      const items = await this.deps
        .clientFor(document.uri)
        .search(context.partialKey, this.deps.collectionFor(document.uri), controller.signal);
      this.deps.onSearchSuccess();
      return new vscode.CompletionList(
        items.map((item, rank) => toCompletionItem(item, rank, range, document.uri)),
        true,
      );
    } catch (error) {
      if (!controller.signal.aborted) {
        this.deps.onSearchError(error);
      }
      return undefined;
    } finally {
      cancellation.dispose();
    }
  }
}

/**
 * Builds the completion shown for one Zotero item.
 *
 * @param item Search result.
 * @param rank Position in Zotero's result order, kept as the tie-breaker.
 * @param range Text the key replaces (see `provideCompletionItems`).
 * @param documentUri Document the key is inserted into; the add-entry command
 *   uses it to find the right `.bib` file.
 */
function toCompletionItem(
  item: ZoteroItem,
  rank: number,
  range: { inserting: vscode.Range; replacing: vscode.Range },
  documentUri: vscode.Uri,
): vscode.CompletionItem {
  const completion = new vscode.CompletionItem(
    { label: item.citeKey, description: item.title },
    vscode.CompletionItemKind.Reference,
  );
  completion.insertText = item.citeKey;
  completion.range = range;
  // VS Code still filters locally between keystrokes; matching on the key,
  // authors, title and year keeps Zotero's results visible while typing.
  completion.filterText = [item.citeKey, item.creators, item.title, item.year].join(' ');
  completion.sortText = String(rank).padStart(3, '0');
  completion.detail = ['Zotero', item.creators, item.year].filter(Boolean).join(' · ');
  completion.documentation = new vscode.MarkdownString()
    .appendMarkdown('**')
    .appendText(item.title)
    .appendMarkdown('**\n\n')
    .appendText([item.creators, item.venue, item.year].filter(Boolean).join(' · '));
  completion.command = {
    title: 'Add to .bib',
    command: ADD_ENTRY_COMMAND,
    arguments: [documentUri.toString(), item.citeKey, item.bibtex],
  };
  return completion;
}
