// Browser integration test: the real app in headless Chrome/Edge, without Tauri runtime and without mocks.
//
//   npm run test:e2e:browser                       (builds, then tests dev server + production preview)
//   node tests/e2e/browser.e2e.mjs --mode=dev      (dev server only, no build needed)
//   node tests/e2e/browser.e2e.mjs --mode=preview  (requires `npm run build`)
//
// Starts its own Vite server and browser on free ports with a temporary profile; everything is removed afterwards.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attach, sleep } from './lib/cdp.mjs';
import { SPLIT_CASES, combineColumns, installHelpers, setSettingsCheckbox, splitAndRead } from './lib/app.mjs';
import {
  ROOT,
  createReporter,
  errorsIn,
  findBrowser,
  formatLogs,
  freePort,
  onCleanup,
  runTest,
  stopProcess,
  waitForCdpClosed,
  waitForHttp,
} from './lib/harness.mjs';

const modeArg = process.argv.find((a) => a.startsWith('--mode='))?.split('=')[1] ?? 'dev,preview';
const modes = modeArg.split(',');
const r = createReporter();

async function startVite(mode) {
  if (mode === 'preview' && !existsSync(join(ROOT, 'dist/index.html'))) {
    throw new Error('dist/ is missing - run `npm run build` first (or use `npm run test:e2e:browser`).');
  }
  const port = await freePort();
  const viteBin = join(ROOT, 'node_modules/vite/bin/vite.js');
  const args = [...(mode === 'preview' ? ['preview'] : []), '--port', String(port), '--strictPort', '--host', '127.0.0.1'];
  const vite = spawn(process.execPath, [viteBin, ...args], { cwd: ROOT, stdio: 'ignore' });
  onCleanup(() => stopProcess(vite));

  const url = `http://127.0.0.1:${port}/`;
  if (!(await waitForHttp(url))) throw new Error(`Vite (${mode}) did not start on ${url}`);
  return { url, stop: () => stopProcess(vite) };
}

async function startBrowser() {
  const profile = mkdtempSync(join(tmpdir(), 'mytextsplitter-e2e-'));
  const browser = spawn(
    findBrowser(),
    [
      '--headless=new',
      '--remote-debugging-port=0', // browser picks a free port and writes it to DevToolsActivePort
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,900',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );
  onCleanup(() => rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  onCleanup(() => stopProcess(browser));

  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  const port = Number(readFileSync(portFile, 'utf8').split('\n')[0]);
  return { port, stop: () => stopProcess(browser) };
}

async function testApp(page, url) {
  const errorsSince = (n) => errorsIn(page.logs, n);
  const shortErrors = (n) => formatLogs(errorsSince(n));

  // --- Start ---
  await page.goto(url);
  await sleep(1500);
  await installHelpers(page);
  r.check('UI starts (header + menu)', await page.eval('!!document.querySelector("header.header") && !!document.querySelector(".left-menu-bar")'));
  r.check('No error boundary', await page.eval('!document.body.innerText.includes("Error Occurred")'));
  r.check('Window controls hidden in browser', await page.eval('!document.querySelector("#titlebar-minimize, #titlebar-maximize, #titlebar-close")'));
  const title = await page.eval('document.title');
  r.check('Tab title set', title === 'my Split Tool: split', title);
  r.check('No errors on startup', errorsSince(0).length === 0, shortErrors(0));
  r.check(
    'Context menu and F5 not blocked in browser',
    await page.eval(`(() => {
      const c = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); document.body.dispatchEvent(c);
      const k = new KeyboardEvent('keydown', { key: 'F5', bubbles: true, cancelable: true }); document.dispatchEvent(k);
      return !c.defaultPrevented && !k.defaultPrevented; })()`)
  );

  // --- Navigation ---
  for (const name of ['sort', 'filter', 'remove', 'diff', 'about', 'split']) {
    const n = page.logs.length;
    await page.eval(`__t.nav('${name}'); true`);
    await sleep(250);
    const cls = await page.eval('__t.page()?.className.split(" ")[0]');
    const navTitle = await page.eval('document.title');
    r.check(`Navigation -> ${name}`, !!cls && navTitle === `my Split Tool: ${name}` && errorsSince(n).length === 0, `${cls} ${shortErrors(n)}`);
  }

  // --- Text operations (JS / Web Worker) ---
  // Split and Combine check the concrete result; Sort/Filter/Remove/Diff only check that they run (Diff/Filter bugs are out of scope).
  let n = page.logs.length;
  await page.eval(`__t.nav('split'); __t.set(__t.textareas()[0], 'a_b_c\\nd_e_f\\ng_h'); true`);
  await sleep(150);
  await page.eval(`__t.page().querySelector('button[title="Split text"]').click(); true`);
  const splitDone = await page.waitFor(`__t.page().innerText.includes('SPLIT RESULT')`);
  r.check('Split', splitDone && errorsSince(n).length === 0, `status="${await page.eval('__t.status()')}" ${shortErrors(n)}`);
  const firstColumns = [['a', 'd', 'g'], ['b', 'e', 'h'], ['c', 'f', '']];
  await page.waitFor(`JSON.stringify(__t.columns()) === ${JSON.stringify(JSON.stringify(firstColumns))}`, 3000);
  const firstResult = await page.eval('__t.columns()');
  r.check('Split result columns (missing value padded)', JSON.stringify(firstResult) === JSON.stringify(firstColumns), JSON.stringify(firstResult));
  r.check('Split ran in a Web Worker', await page.eval(`performance.getEntriesByType('resource').some(e => /SplitWorker/.test(e.name))`));
  r.check('JS processing mode active', await page.eval(`!!__t.page().querySelector('.mode-toggle .fallback-icon')`));
  r.check(
    'Metrics shown, no backend memory metric',
    await page.eval(`!!__t.page().querySelector('.metrics-group .execution-time') && !__t.page().querySelector('.metrics-group .memory-usage')`)
  );

  n = page.logs.length;
  if (await page.eval(`!!document.querySelector('.combine-icon-link')`)) {
    await page.eval(`document.querySelector('.combine-icon-link').click(); true`);
    await sleep(300);
    await page.eval(`document.querySelectorAll('.column-button')[0]?.click(); true`);
    await sleep(200);
    await page.eval(`document.querySelectorAll('.column-button')[2]?.click(); true`);
    await sleep(300);
    const used = await page.eval(`document.querySelectorAll('.column-button-used').length`);
    const combined = await page.eval('__t.combined()');
    r.check(
      'Combine columns (JS mode)',
      used === 2 && combined === 'a:c\nd:f\ng:' && errorsSince(n).length === 0,
      `used=${used} combined=${JSON.stringify(combined)} ${shortErrors(n)}`
    );
    await page.eval(`document.querySelector('.close-combine-btn')?.click(); true`);
    await sleep(200);
  } else {
    r.check('Combine columns (JS mode)', false, 'combine menu entry missing');
  }

  // --- Split B1: late columns, empty input lines kept/skipped, Combine without row offset ---
  n = page.logs.length;
  const b1 = SPLIT_CASES.b1;
  let cols = await splitAndRead(page, b1.text, b1.separator, b1.keep);
  r.check('Split B1: new column padded, empty line kept (default)', JSON.stringify(cols) === JSON.stringify(b1.keep), JSON.stringify(cols));
  const combinedB1 = await combineColumns(page, [2, 0]);
  r.check('Combine Part 3 + Part 1 keeps rows aligned', combinedB1.used === 2 && combinedB1.text === b1.combined, JSON.stringify(combinedB1));
  r.check('Keep Empty Lines can be switched off', (await setSettingsCheckbox(page, 'Keep Empty Lines', false)) === false);
  cols = await splitAndRead(page, b1.text, b1.separator, b1.skip);
  r.check('Split B1: empty line skipped', JSON.stringify(cols) === JSON.stringify(b1.skip), JSON.stringify(cols));
  r.check('Keep Empty Lines switched on again', (await setSettingsCheckbox(page, 'Keep Empty Lines', true)) === true);
  await page.eval(`__t.page().querySelector('.combine-clear')?.click(); __t.set(__t.page().querySelector('.form-add-render input'), '_'); true`);
  r.check('Split B1 checks without errors', errorsSince(n).length === 0, shortErrors(n));

  n = page.logs.length;
  await page.eval(`__t.nav('sort'); __t.set(__t.textareas()[0], 'b\\nc\\na'); true`);
  await sleep(150);
  await page.eval(`__t.page().querySelector('.sort-button').click(); true`);
  await sleep(400);
  const sorted = await page.eval(`__t.textareas()[1].value`);
  r.check('Sort', sorted === 'a\nb\nc' && errorsSince(n).length === 0, JSON.stringify(sorted));

  n = page.logs.length;
  await page.eval(`__t.nav('filter'); __t.set(__t.textareas()[0], 'apple\\nbanana\\napricot'); __t.set(__t.page().querySelector('.form-add-render input'), 'ap'); true`);
  await sleep(150);
  await page.eval(`__t.page().querySelectorAll('.filter-actions button')[1].click(); true`);
  await sleep(1200);
  const filtered = await page.eval(`__t.textareas()[1].value`);
  r.check('Filter (keep) returns a result', filtered.length > 0 && errorsSince(n).length === 0, `${JSON.stringify(filtered)} status="${await page.eval('__t.status()')}"`);

  n = page.logs.length;
  await page.eval(`__t.nav('remove'); __t.set(__t.textareas()[0], 'x\\ny\\nx\\nz'); true`);
  await sleep(150);
  await page.eval(`__t.page().querySelector('.remove-action-button.duplicates').click(); true`);
  await sleep(1200);
  const removed = await page.eval(`__t.textareas()[1].value`);
  r.check('Remove (duplicates)', removed === 'x\ny\nz' && errorsSince(n).length === 0, JSON.stringify(removed));

  n = page.logs.length;
  await page.eval(`__t.nav('diff'); true`);
  await sleep(200);
  // Separate evaluations: React must re-render between the two controlled inputs
  await page.eval(`__t.set(__t.textareas()[0], 'one\\ntwo\\nthree'); true`);
  await sleep(150);
  await page.eval(`__t.set(__t.textareas()[1], 'one\\n2\\nthree\\nfour'); true`);
  await sleep(150);
  await page.eval(`__t.page().querySelector('.diff-button').click(); true`);
  await sleep(1500);
  const diffRows = await page.eval(`__t.page().querySelectorAll('.diff-added, .diff-removed').length`);
  r.check('Diff', diffRows > 0 && errorsSince(n).length === 0, `rows=${diffRows} status="${await page.eval('__t.status()')}"`);

  n = page.logs.length;
  await page.eval(`__t.page().querySelector('.mode-toggle').click(); true`);
  await sleep(300);
  r.check('Mode toggle stays in JS mode', (await page.eval(`!!__t.page().querySelector('.mode-toggle .fallback-icon')`)) && errorsSince(n).length === 0);

  // --- Error path: an invalid regex must be reported as error, not as success ---
  await page.eval(`__t.nav('split'); true`);
  await sleep(200);
  const regexCheckbox = `[...__t.page().querySelectorAll('.input-box')].find(e => /regex/i.test(e.innerText)).querySelector('input')`;
  await page.eval(`${regexCheckbox}.click(); true`);
  await page.eval(`__t.set(__t.page().querySelector('.form-add-render input'), '([a-'); true`);
  await sleep(150);
  await page.eval(`__t.page().querySelector('button[title="Split text"]').click(); true`);
  await sleep(600);
  const snacks = await page.eval('__t.snacks()');
  r.check('Invalid regex reported as error', snacks.some((s) => s.startsWith('error')), JSON.stringify(snacks.slice(-2)));
  await page.eval(`${regexCheckbox}.click(); __t.set(__t.page().querySelector('.form-add-render input'), '_'); true`);

  // --- Settings persistence (localStorage) ---
  n = page.logs.length;
  await page.eval(`document.querySelector('button[title="Settings"]').click(); true`);
  await sleep(300);
  r.check('Settings modal opens', await page.eval(`document.querySelector('.settings-modal-overlay').classList.contains('visible')`));
  const modes = await page.eval('__t.processingModes()');
  r.check('Backend mode not offered in browser', modes.length > 0 && !modes.some((m) => /backend/i.test(m)), JSON.stringify(modes));
  const lineNumbersBefore = await page.eval(`__t.settingsCheckbox('Show Line Numbers').checked`);
  await page.eval(`__t.settingsCheckbox('Show Line Numbers').click(); true`);
  await page.eval(`__t.settingsCheckbox('Dark Mode').click(); true`);
  await sleep(200);
  const themeBefore = await page.eval(`document.documentElement.getAttribute('data-theme')`);
  const stored = await page.eval(`localStorage.getItem('mytextsplitter.settings')`);
  r.check('Settings saved to localStorage', !!stored && errorsSince(n).length === 0, stored);

  n = page.logs.length;
  await page.reload();
  await sleep(1500);
  await installHelpers(page);
  await page.eval(`document.querySelector('button[title="Settings"]').click(); true`);
  await sleep(300);
  const lineNumbersAfter = await page.eval(`__t.settingsCheckbox('Show Line Numbers').checked`);
  const themeAfter = await page.eval(`document.documentElement.getAttribute('data-theme')`);
  r.check(
    'Settings restored after reload',
    lineNumbersAfter === !lineNumbersBefore && themeAfter === themeBefore,
    `lineNumbers ${lineNumbersBefore}->${lineNumbersAfter}, theme ${themeBefore}->${themeAfter}`
  );
  r.check('Reload without errors', errorsSince(n).length === 0, shortErrors(n));

  // --- Damaged storage must not break the start ---
  for (const damaged of ['{not json', 'null', '{"savedPatterns":[null,1],"language":"fr","fontSize":null}']) {
    await page.eval(`localStorage.setItem('mytextsplitter.settings', ${JSON.stringify(damaged)}); true`);
    n = page.logs.length;
    await page.reload();
    await sleep(1200);
    r.check(`Damaged storage ${damaged} -> app starts`, (await page.eval('!!document.querySelector("header.header")')) && errorsSince(n).length === 0, shortErrors(n));
  }

  const tauriIssues = page.logs.filter(
    (l) => /tauri|metadata|reading 'invoke'|transformCallback/i.test(l.text) && !['console.debug', 'console.log', 'console.info'].includes(l.kind)
  );
  r.check('No Tauri-related errors or warnings in the console', tauriIssues.length === 0, formatLogs(tauriIssues));
}

runTest(async () => {
  for (const mode of modes) {
    r.section(`Browser - ${mode === 'preview' ? 'production build (vite preview)' : 'Vite dev server'}`);
    const vite = await startVite(mode);
    const browser = await startBrowser();
    const page = await attach(browser.port);
    try {
      await testApp(page, vite.url);
    } finally {
      page.close();
      await browser.stop();
      await vite.stop();
      r.check('Browser debug port closed after test', await waitForCdpClosed(browser.port));
    }
  }
  return r.summary();
});
