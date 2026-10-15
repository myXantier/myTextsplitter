// Browser baseline of the current sort (Paket 9, Phase B): algorithm and UI measured separately in headless Chrome/Edge.
//
//   node tests/bench/sort-ui-baseline.mjs                  (dev server; plus the production preview if dist/ exists)
//   node tests/bench/sort-ui-baseline.mjs --sizes=1000,10000
//
// algorithm: sortText imported into the page (Vite dev server only), no React.
// ui:        click on "Sort Text" until the next frame. handler = synchronous part of the click (sortText + state update),
//            frame = until the next frame after it (+ React render, result textarea layout and paint).
//            Setting the source text is measured separately ("set input"), it is not part of the sort.
// Not part of `npm test` or the E2E checks (timings depend on the machine).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attach, sleep } from '../e2e/lib/cdp.mjs';
import { installHelpers } from '../e2e/lib/app.mjs';
import { ROOT, findBrowser, freePort, onCleanup, runTest, stopProcess, waitForHttp } from '../e2e/lib/harness.mjs';

const sizes = (process.argv.find((a) => a.startsWith('--sizes='))?.split('=')[1] ?? '1000,10000,100000').split(',').map(Number);
const METHODS = [
  ['alphabetical', 'Alphabetical (A to Z)'],
  ['natural', 'Natural Sort'],
  ['lengthAsc', 'Line Length (Shortest First)'],
];
// The same generator as in Node, inlined into the page (the production bundle cannot import /tests)
const GENERATOR = readFileSync(join(ROOT, 'tests/bench/sort-data.mjs'), 'utf8').replace(/export function/g, 'function');
const fmt = (ms) => ms.toFixed(1);
const nextFrame = 'new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))';

async function startVite(mode) {
  const port = await freePort();
  const args = [...(mode === 'preview' ? ['preview'] : []), '--port', String(port), '--strictPort', '--host', '127.0.0.1'];
  const vite = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), ...args], { cwd: ROOT, stdio: 'ignore' });
  onCleanup(() => stopProcess(vite));
  const url = `http://127.0.0.1:${port}/`;
  if (!(await waitForHttp(url))) throw new Error(`Vite (${mode}) did not start on ${url}`);
  return url;
}

async function startBrowser() {
  const profile = mkdtempSync(join(tmpdir(), 'mytextsplitter-bench-'));
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1280,900', 'about:blank'];
  const browser = spawn(findBrowser(), args, { stdio: 'ignore' });
  onCleanup(() => rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  onCleanup(() => stopProcess(browser));
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  return Number(readFileSync(portFile, 'utf8').split('\n')[0]);
}

async function open(page, url) {
  await page.goto(url);
  await sleep(1500);
  await installHelpers(page);
  await page.eval(`${GENERATOR}; window.__makeSortText = makeSortText; true`);
}

async function algorithm(page) {
  const rows = [];
  for (const size of sizes) {
    const row = await page.eval(`(async () => {
      const { sortText } = await import('/src/utils/sortLines.ts');
      const text = __makeSortText(${size});
      const result = {};
      for (const [method, cs] of [['alphabetical', true], ['alphabetical', false], ['natural', true], ['natural', false], ['lengthAsc', true]]) {
        sortText(text, method, cs);
        const times = [];
        for (let i = 0; i < ${size >= 100000 ? 3 : 5}; i++) { const t = performance.now(); sortText(text, method, cs); times.push(performance.now() - t); }
        result[method + (cs ? ' CS' : ' CI')] = times.sort((a, b) => a - b)[Math.floor(times.length / 2)];
      }
      return result;
    })()`);
    rows.push({ lines: size, ...Object.fromEntries(Object.entries(row).map(([k, v]) => [k, fmt(v)])) });
  }
  console.table(rows);
}

async function ui(page) {
  await page.eval(`__t.nav('sort'); true`);
  await sleep(300);
  const rows = [];
  for (const size of sizes) {
    const row = { lines: size };
    row['set input'] = fmt(
      await page.eval(`(async () => { const text = __makeSortText(${size}); const t = performance.now(); __t.set(__t.textareas()[0], text); await ${nextFrame}; return performance.now() - t; })()`)
    );
    for (const [method, label] of METHODS) {
      await page.eval(`(async () => {
        __t.page().querySelector('.custom-select').click();
        await new Promise((r) => setTimeout(r, 200));
        [...document.querySelectorAll('.select-dropdown li')].find((li) => li.innerText.trim() === ${JSON.stringify(label)}).click();
        await new Promise((r) => setTimeout(r, 200));
        return true;
      })()`);
      const median = await page.eval(`(async () => {
        const runs = [];
        for (let i = 0; i < ${size >= 100000 ? 3 : 5}; i++) {
          const t0 = performance.now();
          __t.page().querySelector('.sort-button').click();
          const t1 = performance.now();
          await ${nextFrame};
          runs.push({ handler: t1 - t0, frame: performance.now() - t0, filled: __t.textareas()[1]?.value.length > 0 });
          await new Promise((r) => setTimeout(r, 100));
        }
        return runs.sort((a, b) => a.frame - b.frame)[Math.floor(runs.length / 2)];
      })()`);
      if (!median.filled) throw new Error(`no sort result for ${method} with ${size} lines`);
      row[`${method} handler`] = fmt(median.handler);
      row[`${method} frame`] = fmt(median.frame);
    }
    rows.push(row);
  }
  console.table(rows);
}

await runTest(async () => {
  const page = await attach(await startBrowser());

  await open(page, await startVite('dev'));
  const env = await page.eval(`({ ua: navigator.userAgent.match(/(Chrome|Edg)\\/[\\d.]+/g)?.join(' '), language: navigator.language, collator: new Intl.Collator().resolvedOptions().locale })`);
  console.log(`Browser ${env.ua}, navigator.language ${env.language}, default collator ${env.collator}`);
  console.log('\n## Algorithm only (sortText in the page, median ms)');
  await algorithm(page);
  console.log('\n## UI, dev server (React development build, median ms)');
  await ui(page);

  if (existsSync(join(ROOT, 'dist/index.html'))) {
    await open(page, await startVite('preview'));
    console.log('\n## UI, production preview (median ms)');
    await ui(page);
  } else {
    console.log('\n(dist/ missing: production preview skipped, run `npm run build` first)');
  }
  return true;
});
