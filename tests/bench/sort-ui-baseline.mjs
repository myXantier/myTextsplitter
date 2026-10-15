// Browser baseline of the sort (Paket 9): algorithm, worker communication and UI responsiveness in headless Chrome/Edge.
//
//   node tests/bench/sort-ui-baseline.mjs                  (dev server; plus the production preview if dist/ exists)
//   node tests/bench/sort-ui-baseline.mjs --sizes=1000,10000
//
// algorithm:  sortText imported into the page (Vite dev server only), in the UI thread, no React.
// service:    SortService.invoke (dev only): postMessage, sort in the worker, answer, validation and metrics.
// main thread: the part of a service job that stays in the UI thread besides the worker (line count check, metrics).
// ui:         click on "Sort Text" until the job is done (button no longer aria-busy) and the next frame is drawn.
//             maxFrameGap = longest time between two animation frames meanwhile (how long the page could not react),
//             longTasks = sum of the browser's long tasks (> 50 ms) meanwhile. Setting the source text is measured separately.
// Not part of `npm test` or the E2E checks (timings depend on the machine).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attach, sleep } from '../e2e/lib/cdp.mjs';
import { installHelpers } from '../e2e/lib/app.mjs';
import { ROOT, findBrowser, freePort, onCleanup, runTest, stopProcess, waitForHttp } from '../e2e/lib/harness.mjs';

const sizes = (process.argv.find((a) => a.startsWith('--sizes='))?.split('=')[1] ?? '1000,10000,100000').split(',').map(Number);
// Index = position in the method dropdown (SORT_METHODS); the labels are translated
const METHODS = [
  ['alphabetical', 0],
  ['natural', 2],
  ['lengthAsc', 4],
];
// The same generator as in Node, inlined into the page (the production bundle cannot import /tests)
const GENERATOR = readFileSync(join(ROOT, 'tests/bench/sort-data.mjs'), 'utf8').replace(/export function/g, 'function');
const fmt = (ms) => ms.toFixed(1);
const nextFrame = 'new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))';
const median = (expr, runs) => `(async () => { const times = []; for (let i = 0; i < ${runs}; i++) times.push(await (${expr})()); return times.sort((a, b) => a - b)[Math.floor(times.length / 2)]; })()`;

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

/** Algorithm in the UI thread vs. the same job through SortService (worker) and the UI-thread share of the latter. */
async function algorithmAndService(page) {
  const rows = [];
  for (const size of sizes) {
    const runs = size >= 100000 ? 3 : 5;
    const row = await page.eval(`(async () => {
      const { sortText } = await import('/src/utils/sortLines.ts');
      const { SortService, countLines } = await import('/src/services/SortService.ts');
      const text = __makeSortText(${size});
      const result = {};
      for (const method of ['alphabetical', 'natural', 'lengthAsc']) {
        const args = { sourceText: text, mainParam: '', configParams: { sortMethod: method, caseSensitive: true } };
        result[method + ' algorithm'] = await ${median(`async () => { const t = performance.now(); sortText(text, method, true); return performance.now() - t; }`, runs)};
        await new SortService().invoke(args);
        result[method + ' service'] = await ${median(`async () => { const t = performance.now(); await new SortService().invoke(args); return performance.now() - t; }`, runs)};
      }
      // UI-thread share of every service job (besides postMessage): line count check and metrics (BaseService.toMetrics)
      const sorted = sortText(text, 'natural', true);
      result['main: line check'] = await ${median(`async () => { const t = performance.now(); countLines(text); countLines(sorted); return performance.now() - t; }`, 5)};
      result['main: metrics'] = await ${median(`async () => { const t = performance.now(); const e = new TextEncoder(); e.encode(JSON.stringify({ sourceText: text })); e.encode(JSON.stringify(sorted)); return performance.now() - t; }`, 5)};
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
    for (const [method, index] of METHODS) {
      await page.eval(`(async () => {
        __t.page().querySelector('.custom-select').click();
        await new Promise((r) => setTimeout(r, 200));
        document.querySelectorAll('.select-dropdown li')[${index}].click();
        await new Promise((r) => setTimeout(r, 200));
        return true;
      })()`);
      const measured = await page.eval(`(async () => {
        const runs = [];
        for (let i = 0; i < ${size >= 100000 ? 3 : 5}; i++) {
          const longTasks = [];
          const observer = new PerformanceObserver((list) => list.getEntries().forEach((e) => longTasks.push(e.duration)));
          observer.observe({ type: 'longtask' });
          let last = performance.now(), maxGap = 0, watching = true;
          const loop = (t) => { maxGap = Math.max(maxGap, t - last); last = t; if (watching) requestAnimationFrame(loop); };
          requestAnimationFrame(loop);
          await ${nextFrame};

          // Done = aria-busy went to "true" (React renders it after the click) and back to "false"
          const button = __t.page().querySelector('.sort-button');
          let busySeen = false, done;
          const finished = new Promise((resolve) => (done = resolve));
          const busyObserver = new MutationObserver(() => {
            if (button.getAttribute('aria-busy') === 'true') busySeen = true;
            else if (busySeen) done();
          });
          busyObserver.observe(button, { attributes: true, attributeFilter: ['aria-busy'] });
          const t0 = performance.now();
          button.click();
          const handler = performance.now() - t0;
          await finished;
          busyObserver.disconnect();
          await ${nextFrame};
          const total = performance.now() - t0;
          watching = false;
          await ${nextFrame};
          observer.disconnect();
          runs.push({ handler, total, maxGap, longTasks: longTasks.reduce((a, b) => a + b, 0), filled: __t.textareas()[1]?.value.length > 0 });
          await new Promise((r) => setTimeout(r, 150));
        }
        return runs.sort((a, b) => a.total - b.total)[Math.floor(runs.length / 2)];
      })()`);
      if (!measured.filled) throw new Error(`no sort result for ${method} with ${size} lines`);
      row[`${method} total`] = fmt(measured.total);
      row[`${method} maxFrameGap`] = fmt(measured.maxGap);
      row[`${method} longTasks`] = fmt(measured.longTasks);
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
  console.log('\n## Algorithm (UI thread) vs. SortService with worker, UI-thread share of a service job (median ms)');
  await algorithmAndService(page);
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
