/**
 * Scripted demo that runs inside VS Code (launched by `record.ts`). It types a
 * sentence with citations the way a user would, accepting Zotero suggestions
 * as they appear, while `record.ts` captures the window.
 *
 * Recording starts when this script creates the `start` marker file and ends
 * at the `stop` marker, so window setup is not part of the GIF.
 */

import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { DEMO_TYPING_LINE } from './demoLibrary';

/** Pause after each typed character, in milliseconds. */
const KEYSTROKE_MS = 85;

/**
 * Entry point called by VS Code's test runner.
 */
export async function run(): Promise<void> {
  const workspace = requiredEnv('ZLC_DEMO_WORKSPACE');
  const markers = requiredEnv('ZLC_DEMO_MARKERS');
  await vscode.extensions.getExtension('local.zotero-live-cite')!.activate();

  // Layout: the LaTeX source on the left, the .bib it fills on the right.
  const bib = await vscode.workspace.openTextDocument(path.join(workspace, 'refs.bib'));
  await vscode.window.showTextDocument(bib, { viewColumn: vscode.ViewColumn.Two, preview: false });
  const tex = await vscode.workspace.openTextDocument(path.join(workspace, 'paper.tex'));
  const editor = await vscode.window.showTextDocument(tex, { viewColumn: vscode.ViewColumn.One, preview: false });
  for (const command of [
    'workbench.action.closeSidebar',
    'workbench.action.closePanel',
    'workbench.action.closeAuxiliaryBar',
    'notifications.clearAll',
  ]) {
    await vscode.commands.executeCommand(command);
  }
  const start = new vscode.Position(DEMO_TYPING_LINE, 0);
  editor.selection = new vscode.Selection(start, start);
  await sleep(2000);

  await writeFile(path.join(markers, 'start'), '');
  await sleep(1000);

  // 1. Cite by author: the list opens on "{" with recent library items. The
  //    details panel (full title, authors, venue) stays open for later lists.
  await type('Self-attention~\\citep{');
  await sleep(700);
  await vscode.commands.executeCommand('toggleSuggestionDetails');
  await sleep(1200);
  await type('vasw');
  await sleep(1300);
  await accept();

  // 2. Cite by a title word, several papers in one \citep.
  await type('} now powers vision~\\citep{');
  await sleep(900);
  await type('image');
  await sleep(1500);
  await accept();
  await type(', ');
  await sleep(700);
  await type('radf');
  await sleep(1300);
  await accept();
  await type('}.');
  await sleep(2500);

  await writeFile(path.join(markers, 'stop'), '');
  await sleep(500);
}

/**
 * Types text into the focused editor one character at a time, through the
 * same `type` command the keyboard uses (so auto-closing brackets and
 * suggestion triggers behave as for a person typing).
 *
 * @param text Characters to type.
 */
async function type(text: string): Promise<void> {
  for (const character of text) {
    await vscode.commands.executeCommand('type', { text: character });
    await sleep(KEYSTROKE_MS);
  }
}

/**
 * Accepts the highlighted suggestion (like pressing Enter), waits for the
 * entry to land in the .bib file, and scrolls the .bib editor to its end so
 * the new entry is in view (as a person glancing at the file would).
 */
async function accept(): Promise<void> {
  await vscode.commands.executeCommand('acceptSelectedSuggestion');
  await sleep(700);
  const bibEditor = vscode.window.visibleTextEditors.find((e) => e.document.fileName.endsWith('.bib'));
  if (bibEditor) {
    const last = bibEditor.document.lineCount - 1;
    bibEditor.revealRange(new vscode.Range(last, 0, last, 0), vscode.TextEditorRevealType.Default);
  }
  await sleep(1300);
}

/**
 * Reads an environment variable set by `record.ts`.
 *
 * @param name Variable name.
 * @throws Error when it is missing.
 */
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

/**
 * Waits.
 *
 * @param ms Milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
