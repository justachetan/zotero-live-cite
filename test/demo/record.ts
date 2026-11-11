/**
 * Records the README demo GIF (`docs/demo.gif`) from a real VS Code window.
 *
 *   npm run demo
 *
 *   record.ts                         VS Code (separate profile)
 *   ─────────                         ──────────────────────────
 *   fake Zotero + demo workspace
 *   launch VS Code ──────────────────▶ extension + driver.ts start
 *   connect over DevTools protocol     driver lays out editors
 *        │                    ◀─────── writes `start` marker
 *   capture a frame every few ms       driver types, accepts suggestions
 *        │                    ◀─────── writes `stop` marker
 *   frames ──▶ ffmpeg ──▶ docs/demo.gif
 *
 * Frames are taken with Chrome DevTools' Page.captureScreenshot on the
 * workbench page, so no macOS screen-recording permission is needed. Each
 * frame keeps its real duration, so the GIF plays at the speed it was typed.
 * Needs ffmpeg on PATH.
 */

import { runTests } from '@vscode/test-electron';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { startFakeZotero } from '../fakeZotero';
import { DEMO_LIBRARY, DEMO_PAPER_TEX, DEMO_REFS_BIB } from './demoLibrary';

const MAC_VSCODE = '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
const DEBUG_PORT = 9339;
/** Page size the workbench is rendered at (CSS pixels, captured at 2x). */
const VIEWPORT = { width: 1080, height: 560 };
/** Width of the output GIF in pixels: one GIF pixel per CSS pixel. */
const GIF_WIDTH = 1080;
/** How long the last frame is held before the GIF loops, in seconds. */
const FINAL_HOLD_S = 2;

/** VS Code user settings that keep the demo window uncluttered. */
const USER_SETTINGS = {
  'workbench.colorTheme': 'Default Dark Modern',
  // A native title bar is drawn outside the captured page, which hides the
  // "[Extension Development Host]" title from the recording.
  'window.titleBarStyle': 'native',
  'workbench.activityBar.location': 'hidden',
  '[latex]': { 'editor.wordWrap': 'on' },
  'workbench.startupEditor': 'none',
  'workbench.tips.enabled': false,
  'workbench.secondarySideBar.defaultVisibility': 'hidden',
  'workbench.layoutControl.enabled': false,
  'window.commandCenter': false,
  'chat.disableAIFeatures': true,
  'editor.fontSize': 16,
  'editor.minimap.enabled': false,
  'editor.wordBasedSuggestions': 'off',
  'editor.stickyScroll.enabled': false,
  'breadcrumbs.enabled': false,
  'security.workspace.trust.enabled': false,
  'update.mode': 'none',
  'telemetry.telemetryLevel': 'off',
  'extensions.ignoreRecommendations': true,
};

/**
 * Sets up the demo, records it and writes the GIF.
 */
async function main(): Promise<void> {
  const root = path.resolve(__dirname, '../../..');
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'zotero-live-cite-demo-'));
  const workspace = path.join(scratch, 'workspace');
  const markers = path.join(scratch, 'markers');
  const frames = path.join(scratch, 'frames');
  const userData = path.join(scratch, 'user-data');
  const zotero = await startFakeZotero(DEMO_LIBRARY);
  try {
    await mkdir(path.join(workspace, '.vscode'), { recursive: true });
    await mkdir(markers);
    await mkdir(frames);
    await mkdir(path.join(userData, 'User'), { recursive: true });
    await writeFile(path.join(workspace, 'paper.tex'), DEMO_PAPER_TEX);
    await writeFile(path.join(workspace, 'refs.bib'), DEMO_REFS_BIB);
    await writeFile(
      path.join(workspace, '.vscode', 'settings.json'),
      JSON.stringify({ 'zoteroLiveCite.libraryUrl': zotero.libraryUrl }, null, 2),
    );
    await writeFile(path.join(userData, 'User', 'settings.json'), JSON.stringify(USER_SETTINGS, null, 2));

    const vscodeRun = runTests({
      vscodeExecutablePath: process.env.VSCODE_EXECUTABLE ?? (existsSync(MAC_VSCODE) ? MAC_VSCODE : undefined),
      extensionDevelopmentPath: root,
      extensionTestsPath: path.join(__dirname, 'driver.js'),
      extensionTestsEnv: { ZLC_DEMO_WORKSPACE: workspace, ZLC_DEMO_MARKERS: markers },
      launchArgs: [
        workspace,
        '--disable-extensions',
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes',
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=${userData}`,
        `--extensions-dir=${path.join(scratch, 'extensions')}`,
      ],
    });
    const captured = await captureFrames(frames, markers);
    await vscodeRun;

    const gif = path.join(root, 'docs', 'demo.gif');
    await mkdir(path.dirname(gif), { recursive: true });
    await encodeGif(captured, path.join(scratch, 'frames.txt'), gif);
    console.log(`Wrote ${gif} from ${captured.length} frames.`);
  } finally {
    await zotero.close();
    await rm(scratch, { recursive: true, force: true });
  }
}

/** One captured frame and when it was taken. */
interface Frame {
  readonly file: string;
  readonly takenAtMs: number;
}

/**
 * Connects to the VS Code window over the DevTools protocol and captures
 * frames between the driver's `start` and `stop` markers.
 *
 * @param framesDir Directory the PNG frames are written to.
 * @param markersDir Directory the driver writes its markers to.
 * @returns Frames in capture order.
 */
async function captureFrames(framesDir: string, markersDir: string): Promise<Frame[]> {
  const page = await DevToolsPage.connect(DEBUG_PORT);
  try {
    await page.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, deviceScaleFactor: 2, mobile: false });
    while (!existsSync(path.join(markersDir, 'start'))) {
      await sleep(50);
    }
    const frames: Frame[] = [];
    while (!existsSync(path.join(markersDir, 'stop'))) {
      const takenAtMs = performance.now();
      const { data } = (await page.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true })) as {
        data: string;
      };
      const file = path.join(framesDir, `frame-${String(frames.length).padStart(5, '0')}.png`);
      await writeFile(file, Buffer.from(data, 'base64'));
      frames.push({ file, takenAtMs });
    }
    return frames;
  } finally {
    page.close();
  }
}

/**
 * Encodes frames into a looping GIF with ffmpeg, giving each frame the time
 * until the next one was captured, and holding the last frame.
 *
 * @param frames Captured frames, in order.
 * @param listFile Scratch path for ffmpeg's concat list.
 * @param gif Output path.
 */
async function encodeGif(frames: readonly Frame[], listFile: string, gif: string): Promise<void> {
  const lines = frames.flatMap((frame, i) => {
    const next = frames[i + 1];
    const seconds = next ? (next.takenAtMs - frame.takenAtMs) / 1000 : FINAL_HOLD_S;
    return [`file '${frame.file}'`, `duration ${seconds.toFixed(3)}`];
  });
  // The concat demuxer ignores the last duration unless the file is repeated.
  lines.push(`file '${frames[frames.length - 1].file}'`);
  await writeFile(listFile, `${lines.join('\n')}\n`);
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', listFile,
    '-vf',
    `fps=12,scale=${GIF_WIDTH}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`,
    '-loop', '0',
    gif,
  ]);
}

/**
 * Minimal DevTools protocol client for one page target.
 */
class DevToolsPage {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } };
      const waiter = message.id === undefined ? undefined : this.pending.get(message.id);
      if (waiter) {
        this.pending.delete(message.id!);
        if (message.error) {
          waiter.reject(new Error(message.error.message));
        } else {
          waiter.resolve(message.result);
        }
      }
    });
  }

  /**
   * Waits for VS Code's workbench page to appear on the debugging port and
   * connects to it.
   *
   * @param port Remote debugging port VS Code was started with.
   * @throws Error when no workbench page appears within 60 seconds.
   */
  static async connect(port: number): Promise<DevToolsPage> {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try {
        const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as {
          type: string;
          url: string;
          webSocketDebuggerUrl: string;
        }[];
        const workbench = targets.find((t) => t.type === 'page' && t.url.includes('workbench'));
        if (workbench) {
          const socket = new WebSocket(workbench.webSocketDebuggerUrl);
          await new Promise((resolve, reject) => {
            socket.addEventListener('open', resolve, { once: true });
            socket.addEventListener('error', reject, { once: true });
          });
          return new DevToolsPage(socket);
        }
      } catch {
        // VS Code has not opened the debugging port yet.
      }
      await sleep(250);
    }
    throw new Error(`No VS Code workbench page on debugging port ${port}.`);
  }

  /**
   * Sends one protocol command and waits for its result.
   *
   * @param method Protocol method, e.g. `Page.captureScreenshot`.
   * @param params Method parameters.
   */
  send(method: string, params: object = {}): Promise<unknown> {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  /** Closes the connection. */
  close(): void {
    this.socket.close();
  }
}

/**
 * Waits.
 *
 * @param ms Milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
