// Shared infrastructure for the integration tests: reporting, guaranteed cleanup, processes, ports.
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sleep, listTargets } from './cdp.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

// Pre-existing, unrelated console error (MyAppLogo renders `<svg width="auto">`); not a Tauri issue.
const KNOWN_CONSOLE_ERRORS = [/<svg> attribute width: Expected length, "auto"/];

/** Errors (exceptions, console.error, browser errors) logged since index `from`. */
export function errorsIn(logs, from = 0) {
  return logs
    .slice(from)
    .filter((l) => ['exception', 'console.error', 'log.error'].includes(l.kind))
    .filter((l) => !KNOWN_CONSOLE_ERRORS.some((re) => re.test(l.text)));
}

export const formatLogs = (entries) => JSON.stringify(entries.map((e) => `${e.kind}: ${e.text.slice(0, 180)}`));

// --- Reporting ---

export function createReporter() {
  const results = [];
  return {
    section(title) {
      console.log(`\n## ${title}`);
    },
    check(name, ok, info = '') {
      results.push({ name, ok: !!ok });
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  -> ${info}` : ''}`);
      return !!ok;
    },
    summary() {
      const failed = results.filter((r) => !r.ok);
      console.log(`\n${results.length - failed.length}/${results.length} passed`);
      failed.forEach((r) => console.log(`  FAILED: ${r.name}`));
      return failed.length === 0;
    },
  };
}

// --- Cleanup (runs on success, failure and Ctrl+C) ---

const cleanups = [];

/** Registers a cleanup step; steps run in reverse order. */
export function onCleanup(fn) {
  cleanups.push(fn);
}

async function runCleanups() {
  while (cleanups.length) {
    const fn = cleanups.pop();
    try {
      await fn();
    } catch (err) {
      console.error('Cleanup step failed:', err);
    }
  }
}

/** Runs a test body; exit code 0 = all checks passed, 1 = failures/errors. */
export async function runTest(body) {
  let interrupted = false;
  const onSignal = async () => {
    if (interrupted) return;
    interrupted = true;
    console.error('\nInterrupted, cleaning up ...');
    await runCleanups();
    process.exit(130);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  let ok = false;
  try {
    ok = await body();
  } catch (err) {
    console.error('\nTest aborted:', err);
  } finally {
    await runCleanups();
  }
  process.exit(ok ? 0 : 1);
}

// --- Processes and ports ---

export function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

export function waitForExit(child, timeout = 10000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => resolveExit(false), timeout);
    child.once('exit', () => {
      clearTimeout(timer);
      resolveExit(true);
    });
  });
}

/** Terminates a child process (if still running) and waits for it to exit. */
export async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  if (!(await waitForExit(child, 5000))) {
    child.kill('SIGKILL');
    await waitForExit(child, 5000);
  }
}

export async function waitForHttp(url, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  return false;
}

/** True once nothing answers on the CDP port anymore (debug interface really closed). */
export async function waitForCdpClosed(port, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if ((await listTargets(port)) === null) return true;
    await sleep(200);
  }
  return false;
}

// --- Browser discovery ---

/** Chrome/Chromium/Edge executable: `CHROME_PATH` env var, then common install locations. */
export function findBrowser() {
  if (process.env.CHROME_PATH) {
    if (existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
    throw new Error(`CHROME_PATH does not exist: ${process.env.CHROME_PATH}`);
  }

  const env = process.env;
  const candidates = {
    win32: [
      [env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'],
      [env['ProgramFiles(x86)'], 'Google/Chrome/Application/chrome.exe'],
      [env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'],
      [env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'],
      [env.ProgramFiles, 'Microsoft/Edge/Application/msedge.exe'],
    ]
      .filter(([base]) => base)
      .map(([base, rel]) => join(base, rel)),
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ],
    linux: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'].flatMap((name) =>
      (env.PATH ?? '').split(delimiter).map((dir) => join(dir, name))
    ),
  };

  const found = (candidates[process.platform] ?? []).find((p) => existsSync(p));
  if (!found) throw new Error('No Chrome/Chromium/Edge found. Set CHROME_PATH to the browser executable.');
  return found;
}
