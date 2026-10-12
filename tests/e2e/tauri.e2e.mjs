// Tauri smoke test: the real release build with the real Tauri runtime and Rust backend (no mocks).
// Windows only: the WebView2 is driven through its DevTools port (WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS).
//
//   npx tauri build --no-bundle   (once, or after code changes)
//   npm run test:e2e:tauri
//
// The app is started twice (change + close, then restart). The user's settings.json is backed up before
// and restored afterwards, also on failure or Ctrl+C. Optional: TAURI_APP_PATH overrides the executable.
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attach, listTargets, sleep } from './lib/cdp.mjs';
import { SPLIT_CASES, combineColumns, installHelpers, setSettingsCheckbox, splitAndRead } from './lib/app.mjs';
import {
  ROOT,
  createReporter,
  errorsIn,
  formatLogs,
  freePort,
  onCleanup,
  runTest,
  stopProcess,
  waitForCdpClosed,
  waitForExit,
} from './lib/harness.mjs';

const r = createReporter();

if (process.platform !== 'win32') {
  console.log('SKIPPED: the Tauri smoke test needs WebView2 remote debugging (Windows only).');
  console.log('WebKitGTK (Linux) has no DevTools protocol; see tests/README.md.');
  process.exit(0);
}

const cargoToml = readFileSync(join(ROOT, 'src-tauri/Cargo.toml'), 'utf8');
const binName = /^\[package\][^[]*?^name\s*=\s*"([^"]+)"/m.exec(cargoToml)?.[1];
const APP = process.env.TAURI_APP_PATH ?? join(ROOT, 'src-tauri/target/release', `${binName}.exe`);
const identifier = JSON.parse(readFileSync(join(ROOT, 'src-tauri/tauri.conf.json'), 'utf8')).identifier;
// Same location as the Rust backend (dirs::config_dir() = %APPDATA% on Windows)
const SETTINGS_FILE = join(process.env.APPDATA, identifier, 'settings.json');

const tauriCall = (cmd, args = {}) => `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)})`;
const readSettingsFile = () => JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));

function newestSourceTime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestSourceTime(path) : statSync(path).mtimeMs);
  }
  return newest;
}

function isAppRunning() {
  const out = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${binName}.exe`, '/NH'], { encoding: 'utf8' });
  return out.toLowerCase().includes(`${binName}.exe`);
}

/** Backs up the user's settings file and restores it in every case. */
function protectUserSettings() {
  const backupDir = mkdtempSync(join(tmpdir(), 'mytextsplitter-settings-'));
  const backup = join(backupDir, 'settings.json');
  const existed = existsSync(SETTINGS_FILE);
  if (existed) copyFileSync(SETTINGS_FILE, backup);
  console.log(`Settings backup: ${existed ? backup : '(no settings file yet)'}`);

  onCleanup(() => {
    if (existed) copyFileSync(backup, SETTINGS_FILE);
    else rmSync(SETTINGS_FILE, { force: true });
    rmSync(backupDir, { recursive: true, force: true });
    console.log('User settings restored.');
  });
}

/** Starts the app with a WebView2 debug port; returns the process and its CDP port. */
async function launchApp() {
  const port = await freePort();
  const app = spawn(APP, [], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
    stdio: 'ignore',
  });
  onCleanup(() => stopProcess(app));
  return { app, port };
}

/** Splash screen -> main window. Returns the attached main page. */
async function checkStartup(port) {
  let splash = null;
  try {
    splash = await attach(port, (t) => t.type === 'page' && /splashscreen/.test(t.url));
    r.check('Splash screen runs with Tauri runtime', await splash.eval(`'__TAURI_INTERNALS__' in window && window.isTauri === true`));
  } catch (err) {
    r.check('Splash screen reachable', false, err.message);
  }

  const main = await attach(port, (t) => t.type === 'page' && !/splashscreen/.test(t.url));
  const start = Date.now();
  let visible = false;
  while (!visible && Date.now() - start < 15000) {
    visible = await main.eval(tauriCall('plugin:window|is_visible', { label: 'main' })).catch(() => false);
    if (!visible) await sleep(200);
  }
  r.check('Main window shown after splash', visible, `${Date.now() - start}ms`);
  await sleep(800);
  r.check('Splash window closed', !(await listTargets(port))?.some((t) => /splashscreen/.test(t.url)));
  if (splash) {
    r.check('Splash without errors', errorsIn(splash.logs).length === 0, formatLogs(errorsIn(splash.logs)));
    splash.close();
  }

  await installHelpers(main);
  r.check('Header + menu visible', await main.eval('!!document.querySelector("header.header") && !!document.querySelector(".left-menu-bar")'));
  r.check('Window controls present', await main.eval('["minimize", "maximize", "close"].every(b => document.querySelector("#titlebar-" + b))'));
  const title = await main.eval(tauriCall('plugin:window|title', { label: 'main' }));
  r.check('Window title set via Tauri', title === 'my Split Tool: split', title);
  r.check('Rust backend reachable', (await main.eval(tauriCall('is_backend_available'))) === true);
  r.check('No browser settings in localStorage on desktop', (await main.eval(`localStorage.getItem('mytextsplitter.settings')`)) === null);
  return main;
}

async function firstRun() {
  r.section('Tauri - first start');
  const { app, port } = await launchApp();
  const main = await checkStartup(port);

  const settings = await main.eval(tauriCall('get_settings'));
  r.check('get_settings returns Rust settings', !!settings && 'windowSize' in settings, JSON.stringify(settings));

  // Backend processing and metrics
  let n = main.logs.length;
  r.check('Default mode is backend', await main.eval(`!!__t.page().querySelector('.mode-toggle .backend-icon')`));
  await main.eval(`__t.set(__t.textareas()[0], 'a_b_c\\nd_e_f'); true`);
  await sleep(150);
  await main.eval(`__t.page().querySelector('button[title="Split text"]').click(); true`);
  const splitDone = await main.waitFor(`__t.page().innerText.includes('SPLIT RESULT')`);
  r.check('Split via Rust backend', splitDone && errorsIn(main.logs, n).length === 0, `status="${await main.eval('__t.status()')}"`);
  r.check(
    'Backend metrics shown (time + memory)',
    await main.eval(`!!__t.page().querySelector('.metrics-group .execution-time') && !!__t.page().querySelector('.metrics-group .memory-usage')`)
  );

  const firstColumns = [['a', 'd'], ['b', 'e'], ['c', 'f']];
  await main.waitFor(`JSON.stringify(__t.columns()) === ${JSON.stringify(JSON.stringify(firstColumns))}`, 3000);
  const firstResult = await main.eval('__t.columns()');
  r.check('Split result columns (Rust)', JSON.stringify(firstResult) === JSON.stringify(firstColumns), JSON.stringify(firstResult));

  // Split B1 via Rust: late columns, empty input lines kept/skipped, Combine (connect_texts) without row offset
  n = main.logs.length;
  const b1 = SPLIT_CASES.b1;
  // Set explicitly: an existing settings.json may still contain showEmptyLines=false (old default)
  r.check('Keep Empty Lines switched on', (await setSettingsCheckbox(main, 'Keep Empty Lines', true)) === true);
  let cols = await splitAndRead(main, b1.text, b1.separator, b1.keep);
  r.check('Split B1 (Rust): new column padded, empty line kept', JSON.stringify(cols) === JSON.stringify(b1.keep), JSON.stringify(cols));
  const combinedB1 = await combineColumns(main, [2, 0]);
  r.check('Combine Part 3 + Part 1 (Rust connect_texts) keeps rows aligned', combinedB1.used === 2 && combinedB1.text === b1.combined, JSON.stringify(combinedB1));
  await main.eval(`__t.page().querySelector('.combine-clear')?.click(); true`);
  const keepBefore = await setSettingsCheckbox(main, 'Keep Empty Lines', false);
  cols = await splitAndRead(main, b1.text, b1.separator, b1.skip);
  r.check('Split B1 (Rust): empty line skipped', keepBefore === false && JSON.stringify(cols) === JSON.stringify(b1.skip), JSON.stringify(cols));
  r.check('Keep Empty Lines switched on again', (await setSettingsCheckbox(main, 'Keep Empty Lines', true)) === true);
  r.check('Split B1 (Rust) without errors', errorsIn(main.logs, n).length === 0, formatLogs(errorsIn(main.logs, n)));

  n = main.logs.length;
  await main.eval(`__t.page().querySelector('.mode-toggle').click(); true`);
  await sleep(300);
  r.check('Toggle to JS mode', await main.eval(`!!__t.page().querySelector('.mode-toggle .fallback-icon')`));
  await main.eval(`__t.page().querySelector('button[title="Split text"]').click(); true`);
  await sleep(1200);
  r.check('Split in JS mode on desktop', errorsIn(main.logs, n).length === 0, `status="${await main.eval('__t.status()')}"`);
  cols = await splitAndRead(main, b1.text, b1.separator, b1.keep);
  r.check('Split B1 in JS mode on desktop = Rust result', JSON.stringify(cols) === JSON.stringify(b1.keep), JSON.stringify(cols));
  await main.eval(`__t.set(__t.page().querySelector('.form-add-render input'), '_'); true`);
  await main.eval(`__t.page().querySelector('.mode-toggle').click(); true`);
  await sleep(300);
  r.check('Toggle back to backend mode', await main.eval(`!!__t.page().querySelector('.mode-toggle .backend-icon')`));

  // Settings -> Rust state
  await main.eval(`document.querySelector('button[title="Settings"]').click(); true`);
  await sleep(300);
  const modes = await main.eval('__t.processingModes()');
  r.check('Desktop offers both processing modes', modes.length === 2, JSON.stringify(modes));
  const lineNumbersBefore = await main.eval(`__t.settingsCheckbox('Show Line Numbers').checked`);
  await main.eval(`__t.settingsCheckbox('Show Line Numbers').click(); true`);
  await sleep(300);
  const changed = await main.eval(tauriCall('get_settings'));
  r.check('Settings change reaches Rust state', changed.showLineNumbers === !lineNumbersBefore && 'windowSize' in changed, JSON.stringify(changed));
  await main.eval(`document.querySelector('.settings-modal .close-button').click(); true`);
  await sleep(200);

  // Window controls (title bar buttons) and window events
  const isMaximized = () => main.eval(tauriCall('plugin:window|is_maximized', { label: 'main' }));
  const borderWidth = () => main.eval(`document.querySelector('.border').style.getPropertyValue('--border-width')`);
  await main.eval(`document.querySelector('#titlebar-maximize button').click(); true`);
  await sleep(800);
  r.check('Maximize + onResized event', (await isMaximized()) === true && (await borderWidth()) === '0px', `border=${await borderWidth()}`);
  await main.eval(`document.querySelector('#titlebar-maximize button').click(); true`);
  await sleep(800);
  r.check('Restore', (await isMaximized()) === false && (await borderWidth()) === '1px', `border=${await borderWidth()}`);
  await main.eval(`document.querySelector('#titlebar-minimize button').click(); true`);
  await sleep(600);
  r.check('Minimize', (await main.eval(tauriCall('plugin:window|is_minimized', { label: 'main' }))) === true);
  await main.eval(tauriCall('plugin:window|unminimize', { label: 'main' }));
  await sleep(600);

  r.check('No errors in main window', errorsIn(main.logs).length === 0, formatLogs(errorsIn(main.logs)));

  // Close via title bar -> Rust writes the settings file and exits
  await main.eval(`document.querySelector('#titlebar-close button').click(); true`).catch(() => {});
  main.close();
  r.check('Close button exits the app', await waitForExit(app, 10000));
  const file = readSettingsFile();
  r.check('Settings file written on close', file.showLineNumbers === !lineNumbersBefore && Array.isArray(file.windowSize), JSON.stringify(file));
  r.check('WebView2 debug port closed', await waitForCdpClosed(port));
  return !lineNumbersBefore;
}

async function secondRun(expectedLineNumbers) {
  r.section('Tauri - restart');
  const { app, port } = await launchApp();
  const main = await checkStartup(port);
  await main.eval(`document.querySelector('button[title="Settings"]').click(); true`);
  await sleep(300);
  const checked = await main.eval(`__t.settingsCheckbox('Show Line Numbers').checked`);
  r.check('Settings loaded after restart', checked === expectedLineNumbers, `checkbox=${checked}`);
  r.check('No errors in main window', errorsIn(main.logs).length === 0, formatLogs(errorsIn(main.logs)));
  main.close();
  await stopProcess(app);
  r.check('WebView2 debug port closed', await waitForCdpClosed(port));
}

runTest(async () => {
  if (!existsSync(APP)) throw new Error(`App not found: ${APP} - run \`npx tauri build --no-bundle\` first.`);
  if (isAppRunning()) throw new Error(`${binName}.exe is already running - close it first (WebView2 would reuse its process).`);

  const appTime = statSync(APP).mtimeMs;
  const sourceTime = Math.max(newestSourceTime(join(ROOT, 'src')), newestSourceTime(join(ROOT, 'src-tauri/src')));
  if (sourceTime > appTime) console.warn('WARNING: sources are newer than the app build - run `npx tauri build --no-bundle`.');

  protectUserSettings();
  const expectedLineNumbers = await firstRun();
  await secondRun(expectedLineNumbers);
  return r.summary();
});
