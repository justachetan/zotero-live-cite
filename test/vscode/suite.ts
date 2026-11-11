/**
 * End-to-end checks that run inside VS Code (see `runTests.ts`): completion
 * through VS Code's own completion API, then the accept command writing the
 * `.bib` file on disk.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'local.zotero-live-cite';

/**
 * Entry point called by VS Code's test runner; any thrown error fails the run.
 */
export async function run(): Promise<void> {
  const workspace = process.env.ZLC_TEST_WORKSPACE;
  assert.ok(workspace, 'ZLC_TEST_WORKSPACE is not set');
  const texUri = vscode.Uri.file(path.join(workspace, 'paper.tex'));
  const bibPath = path.join(workspace, 'refs.bib');

  const document = await vscode.workspace.openTextDocument(texUri);
  const editor = await vscode.window.showTextDocument(document);
  assert.equal(document.languageId, 'latex');
  await vscode.extensions.getExtension(EXTENSION_ID)!.activate();

  // Line 2 is `See \cite{vaswani_at} for details.`; put the cursor after "vaswani_at".
  const line = 2;
  const cursor = new vscode.Position(line, document.lineAt(line).text.indexOf('vaswani_at') + 'vaswani_at'.length);
  // Shaw et al. matches through its co-author Vaswani; the duplicate Vaswani
  // item in the fake library is offered once.
  const items = await zoteroCompletions(texUri, cursor);
  assert.deepEqual(items.map(labelOf), ['vaswani_attention_2017', 'shaw_self-attention_2018']);

  const [item] = items;
  const range = item.range as { inserting: vscode.Range; replacing: vscode.Range };
  assert.equal(document.getText(range.inserting), 'vaswani_at');
  assert.equal(document.getText(range.replacing), 'vaswani_at');

  // Accept the item the way the suggest widget does: apply its edit, then run
  // its command.
  await editor.edit((edit) => edit.replace(range.replacing, item.insertText as string));
  const command = item.command!;
  await vscode.commands.executeCommand(command.command, ...command.arguments!);

  assert.equal(document.lineAt(line).text, 'See \\cite{vaswani_attention_2017} for details.');
  const bib = await readFile(bibPath, 'utf8');
  assert.match(bib, /^@misc\{existing_key_2020,\n\ttitle = \{Existing\},\n\}\n\n@misc\{vaswani_attention_2017,\n/);
  assert.ok(bib.endsWith('}\n'), 'appended entry should end the file with a newline');

  // Citing the same paper again must not duplicate its entry.
  await vscode.commands.executeCommand(command.command, ...command.arguments!);
  const bibAgain = await readFile(bibPath, 'utf8');
  assert.equal(bibAgain.match(/@misc\{vaswani_attention_2017,/g)?.length, 1);

  // Outside a citation command there are no Zotero suggestions.
  const outside = await zoteroCompletions(texUri, new vscode.Position(line, 'See'.length));
  assert.deepEqual(outside, []);
}

/**
 * Asks VS Code for completions and keeps only this extension's items.
 *
 * @param uri Document to complete in.
 * @param position Cursor position.
 */
async function zoteroCompletions(uri: vscode.Uri, position: vscode.Position): Promise<vscode.CompletionItem[]> {
  const list = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider',
    uri,
    position,
  );
  return list.items.filter((item) => item.detail?.startsWith('Zotero'));
}

/**
 * Reads a completion item's label text.
 *
 * @param item Completion item.
 */
function labelOf(item: vscode.CompletionItem): string {
  return typeof item.label === 'string' ? item.label : item.label.label;
}
