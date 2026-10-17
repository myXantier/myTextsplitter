// Browser baseline of the Filter pattern preview (Paket 10, R3 / decision E7): size of the worker answer and cost of the
// answer and of the rendering in headless Chrome/Edge, for bounded inputs. Since Paket 10 C2 the answer is limited
// (`PREVIEW_LIMITS` in src/utils/matchPreview.ts); the Phase B numbers (before the limits) are in
// docs/analyse/Paket10-PhaseB-Regexvertrag.md §7.
//
//   node tests/bench/preview-baseline.mjs                  (dev server; plus the production preview if dist/ exists)
//
// service: MatchPreviewService.invoke (dev only): regex in the worker, structured clone of the answer to the page.
//          rows = stored rows, row segments = segments of the first (shown) row, total = all segments, KB = JSON size of
//          the answer, complete = no limit was reached.
// ui:      the pattern is typed into the Filter page with the preview open; total = from setting the pattern until the
//          first row is rendered (includes the 250 ms debounce), spans = rendered spans of the preview row,
//          maxFrameGap = longest time between two animation frames meanwhile (how long the page could not react),
//          longTasks = sum of the browser's long tasks (> 50 ms).
// Not part of `npm test` or the E2E checks (timings depend on the machine). The browser runs with a temporary profile
// and is stopped afterwards.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attach, sleep } from '../e2e/lib/cdp.mjs';
import { installHelpers } from '../e2e/lib/app.mjs';
import { ROOT, findBrowser, freePort, onCleanup, runTest, stopProcess, waitForHttp } from '../e2e/lib/harness.mjs';

const fmt = (ms) => ms.toFixed(1);
const nextFrame = 'new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))';

/** [label, text expression (evaluated in the page), pattern] – the text is built in the page, not sent over CDP. */
const SCENARIOS = [
  ['1 line, 1,000 matches', `'ab'.repeat(1000)`, 'a'],
  ['1 line, 10,000 matches', `'ab'.repeat(10000)`, 'a'],
  ['1 line, 50,000 matches', `'ab'.repeat(50000)`, 'a'],
  ['1 line, 100,000 matches', `'ab'.repeat(100000)`, 'a'],
  ['1 line 1 MB, 500,000 matches', `'ab'.repeat(500000)`, 'a'],
  ['1,000 short lines', `'xa\\n'.repeat(1000)`, 'a'],
  ['10,000 short lines', `'xa\\n'.repeat(10000)`, 'a'],
  ['100,000 short lines', `'xa\\n'.repeat(100000)`, 'a'],
  ['1 MB, 10 matches', `('b'.repeat(99999) + 'a\\n').repeat(10)`, 'a'],
  ['1 MB one line, 1 match in the middle', `'x'.repeat(500000) + 'MATCH' + 'y'.repeat(500000)`, 'MATCH'],
  ['200 KB, zero-width only', `'ab'.repeat(100000)`, '(?=a)'],
  ['200 KB, emoji, dot (2 matches per emoji)', `'😀x'.repeat(66666)`, '.'],
  ['200 KB one line, pattern ab (100,000 matches, longer)', `'ab'.repeat(100000)`, 'ab'],
  ['200 KB one line, pattern (ab){100} (1,000 matches)', `'ab'.repeat(100000)`, '(ab){100}'],
  ['200 KB in 1,000 lines of 200, pattern a', `('ab'.repeat(100) + '\\n').repeat(1000)`, 'a'],
];

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
}

/** Highlights of the first row per scenario (from the service run), used to detect the rendered preview in the UI runs */
const expectedHighlights = new Map();

/** Answer of the preview service: sizes and time (worker + transfer of the answer to the page). */
async function service(page) {
  const rows = [];
  for (const [label, text, pattern] of SCENARIOS) {
    const row = await page.eval(`(async () => {
      const { MatchPreviewService } = await import('/src/services/Services.ts');
      const sourceText = ${text};
      const args = { sourceText, mainParam: ${JSON.stringify(pattern)}, configParams: { caseSensitive: true, splitMatches: false } };
      await new MatchPreviewService().invoke(args, false);
      const times = [];
      let result;
      for (let i = 0; i < 3; i++) {
        const t = performance.now();
        result = (await new MatchPreviewService().invoke(args, false)).result;
        times.push(performance.now() - t);
      }
      const total = result.rows.reduce((n, r) => n + r.segments.length, 0);
      const first = result.rows[0];
      return {
        kb: (sourceText.length / 1024).toFixed(0), rows: result.rows.length, rowSegments: first?.segments.length ?? 0, total,
        answerKb: (JSON.stringify(result).length / 1024).toFixed(1), complete: result.complete,
        highlights: first ? (first.segments.length - 1) / 2 : 0, ms: times.sort((a, b) => a - b)[1],
      };
    })()`);
    expectedHighlights.set(label, row.highlights);
    rows.push({
      scenario: label, 'text KB': row.kb, rows: row.rows, 'row segments': row.rowSegments, 'total segments': row.total,
      'answer KB': row.answerKb, complete: row.complete, 'service ms': fmt(row.ms),
    });
  }
  console.table(rows);
}

async function ui(page) {
  await page.eval(`__t.nav('filter'); true`);
  await sleep(300);
  const previewCheckbox = `[...__t.page().querySelectorAll('.input-box')].find(e => /pattern matches/i.test(e.innerText)).querySelector('input')`;
  await page.eval(`${previewCheckbox}.checked || ${previewCheckbox}.click(); true`);
  const rows = [];
  for (const [label, text, pattern] of SCENARIOS) {
    const highlights = expectedHighlights.get(label);
    await page.eval(`__t.set(__t.page().querySelector('.form-add-render input'), ''); true`);
    await sleep(400);
    await page.eval(`(async () => { __t.set(__t.textareas()[0], ${text}); await ${nextFrame}; return true; })()`);
    await sleep(500);
    const measured = await page.eval(`(async () => {
      const longTasks = [];
      const observer = new PerformanceObserver((list) => list.getEntries().forEach((e) => longTasks.push(e.duration)));
      observer.observe({ type: 'longtask' });
      let last = performance.now(), maxGap = 0, watching = true;
      const loop = (t) => { maxGap = Math.max(maxGap, t - last); last = t; if (watching) requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
      await ${nextFrame};
      const t0 = performance.now();
      __t.set(__t.page().querySelector('.form-add-render input'), ${JSON.stringify(pattern)});
      const preview = () => __t.page().querySelector('.match-preview');
      const done = () => ${highlights} ? preview()?.querySelectorAll('.match-highlight').length === ${highlights} : !!preview()?.querySelector('.preview-note');
      const end = t0 + 60000;
      while (performance.now() < end && !done()) await new Promise((r) => setTimeout(r, 5));
      await ${nextFrame};
      const total = performance.now() - t0;
      watching = false;
      await ${nextFrame};
      observer.disconnect();
      return { total, maxGap, longTasks: longTasks.reduce((a, b) => a + b, 0), done: done(), spans: preview()?.querySelector('.preview-content')?.querySelectorAll('span').length ?? 0, incomplete: !!preview()?.querySelector('.preview-note.incomplete') };
    })()`);
    if (!measured.done) throw new Error(`${label}: preview not rendered`);
    rows.push({ scenario: label, 'shown spans': measured.spans, incomplete: measured.incomplete, 'total ms': fmt(measured.total), 'maxFrameGap ms': fmt(measured.maxGap), 'longTasks ms': fmt(measured.longTasks) });
  }
  await page.eval(`__t.set(__t.page().querySelector('.form-add-render input'), ''); __t.set(__t.textareas()[0], ''); true`);
  console.table(rows);
}

await runTest(async () => {
  const page = await attach(await startBrowser());

  await open(page, await startVite('dev'));
  const env = await page.eval(`navigator.userAgent.match(/(Chrome|Edg)\\/[\\d.]+/g)?.join(' ')`);
  console.log(`Browser ${env}`);
  console.log('\n## Preview service (worker + answer to the page, median of 3, ms)');
  await service(page);
  console.log('\n## UI, dev server (React development build)');
  await ui(page);

  if (existsSync(join(ROOT, 'dist/index.html'))) {
    await open(page, await startVite('preview'));
    console.log('\n## UI, production preview');
    await ui(page);
  } else {
    console.log('\n(dist/ missing: production preview skipped, run `npm run build` first)');
  }
  return true;
});
