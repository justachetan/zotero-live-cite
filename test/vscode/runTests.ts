/**
 * Launches VS Code with the extension under development and runs `suite.ts`
 * inside it, against a fake Zotero server and a throwaway workspace.
 *
 * Uses the VS Code installed in /Applications when present (set
 * VSCODE_EXECUTABLE to override); otherwise @vscode/test-electron downloads a
 * copy into .vscode-test/. The test opens its own VS Code window with a
 * separate profile, so it does not touch your running editor or settings.
 *
 * Run with `npm run test:vscode`.
 */

import { runTests } from '@vscode/test-electron';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { SAMPLE_LIBRARY, startFakeZotero } from '../fakeZotero';

const MAC_VSCODE = '/Applications/Visual Studio Code.app/Contents/MacOS/Code';

/** LaTeX source with a half-typed key at line 2 for the suite to complete. */
const PAPER_TEX = [
  '\\documentclass{article}',
  '\\begin{document}',
  'See \\cite{vaswani_at} for details.',
  '\\bibliography{refs}',
  '\\end{document}',
  '',
].join('\n');

/** Existing bibliography, deliberately without a final newline. */
const REFS_BIB = '@misc{existing_key_2020,\n\ttitle = {Existing},\n}';

/**
 * Creates the fixtures, runs the suite in VS Code and cleans up.
 */
async function main(): Promise<void> {
  const extensionRoot = path.resolve(__dirname, '../../..');
  const zotero = await startFakeZotero(SAMPLE_LIBRARY);
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'zotero-live-cite-test-'));
  const workspace = path.join(scratch, 'workspace');
  try {
    await mkdir(path.join(workspace, '.vscode'), { recursive: true });
    await writeFile(path.join(workspace, 'paper.tex'), PAPER_TEX);
    await writeFile(path.join(workspace, 'refs.bib'), REFS_BIB);
    await writeFile(
      path.join(workspace, '.vscode', 'settings.json'),
      JSON.stringify({ 'zoteroLiveCite.libraryUrl': zotero.libraryUrl }, null, 2),
    );

    await runTests({
      vscodeExecutablePath: process.env.VSCODE_EXECUTABLE ?? (existsSync(MAC_VSCODE) ? MAC_VSCODE : undefined),
      extensionDevelopmentPath: extensionRoot,
      extensionTestsPath: path.join(__dirname, 'suite.js'),
      extensionTestsEnv: { ZLC_TEST_WORKSPACE: workspace },
      launchArgs: [
        workspace,
        '--disable-extensions',
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes',
        `--user-data-dir=${path.join(scratch, 'user-data')}`,
        `--extensions-dir=${path.join(scratch, 'extensions')}`,
      ],
    });
  } finally {
    await zotero.close();
    await rm(scratch, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
