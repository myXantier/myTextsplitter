// DOM helpers for driving the myTextsplitter UI through CDP (installed as `window.__t` in the page).

export const APP_HELPERS = `window.__t = {
  /** Currently visible page container */
  page: () => document.querySelector('.app-container-column:not(.hide-page)'),
  /** Sets the value of a React-controlled input/textarea */
  set(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  },
  nav(name) { document.querySelector('a[page-name="' + name + '"]').click(); },
  textareas: () => [...__t.page().querySelectorAll('textarea')],
  snacks: () => [...document.querySelectorAll('.snackbar-message')].map(e => e.className.split(' ')[1] + ': ' + e.innerText.trim()),
  status() { const s = __t.page()?.querySelector('.processing-status'); return s ? s.innerText.replace(/\\s+/g, ' ').trim() : null; },
  /** Split result as column-major array (values of the rendered rows; fine for small results) */
  columns: () => [...__t.page().querySelectorAll('.result-column')].map(c => [...c.querySelectorAll('.virtualized-input')].map(i => i.value)),
  combined: () => __t.page().querySelector('.combine-textarea')?.value ?? null,
  /** Records every snackbar shown from now on (also ones that disappear again); read + reset with takeSnacks() */
  watchSnacks() {
    __t.snackLog = [];
    if (__t.snackObserver) return;
    __t.snackObserver = new MutationObserver((mutations) => mutations.forEach((m) => m.addedNodes.forEach((n) => {
      if (n.nodeType !== 1) return;
      const found = n.matches('.snackbar-message') ? [n] : [...n.querySelectorAll('.snackbar-message')];
      found.forEach((e) => __t.snackLog.push(e.className.split(' ')[1] + ': ' + e.innerText.trim()));
    })));
    __t.snackObserver.observe(document.body, { childList: true, subtree: true });
  },
  takeSnacks() { const log = __t.snackLog; __t.snackLog = []; return log; },
  settingsCheckbox(label) {
    return [...document.querySelectorAll('.settings-modal label')].find(l => l.innerText.includes(label)).querySelector('input');
  },
  /** Opens the "Processing Mode" dropdown in the settings modal and returns its options */
  async processingModes() {
    const section = [...document.querySelectorAll('.settings-modal .settings-section')].find(s => s.innerText.includes('Processing'));
    section.querySelector('.custom-select').click();
    await new Promise(r => setTimeout(r, 300));
    const modes = [...document.querySelectorAll('.select-dropdown li')].map(l => l.innerText.trim());
    section.querySelector('.custom-select').click();
    return modes;
  },
}; true`;

/** Installs the helpers (again after every reload) */
export const installHelpers = (page) => page.eval(APP_HELPERS);

// Split cases checked in the integration tests (same expectations as tests/fixtures/split-cases.json).
export const SPLIT_CASES = {
  b1: {
    text: 'A,B\nC,D,E\n\nF,G',
    separator: ',',
    keep: [['A', 'C', '', 'F'], ['B', 'D', '', 'G'], ['', 'E', '', '']],
    skip: [['A', 'C', 'F'], ['B', 'D', 'G'], ['', 'E', '']],
    // Part 3 then Part 1 with separator ':' (keep empty lines)
    combined: ':A\nE:C\n:\n:F',
  },
};

/**
 * Sets text + separator on the Split page, splits and returns the rendered result columns.
 * Waits (max. 5 s) until the result equals `expected`; on timeout the actual result is returned for the report.
 */
export async function splitAndRead(page, text, separator, expected) {
  await page.eval(`__t.nav('split'); true`);
  await new Promise((r) => setTimeout(r, 150));
  // Separate evaluations: React must re-render between the two controlled inputs
  await page.eval(`__t.set(__t.textareas()[0], ${JSON.stringify(text)}); true`);
  await new Promise((r) => setTimeout(r, 150));
  await page.eval(`__t.set(__t.page().querySelector('.form-add-render input'), ${JSON.stringify(separator)}); true`);
  await new Promise((r) => setTimeout(r, 150));
  await page.eval(`__t.page().querySelector('button[title="Split text"]').click(); true`);
  await page.waitFor(`JSON.stringify(__t.columns()) === ${JSON.stringify(JSON.stringify(expected))}`, 5000);
  return page.eval('__t.columns()');
}

/** Toggles a checkbox in the settings modal to `value` and closes the modal again. */
export async function setSettingsCheckbox(page, label, value) {
  await page.eval(`document.querySelector('button[title="Settings"]').click(); true`);
  await new Promise((r) => setTimeout(r, 300));
  await page.eval(`(() => { const c = __t.settingsCheckbox(${JSON.stringify(label)}); if (c.checked !== ${value}) c.click(); })(); true`);
  await new Promise((r) => setTimeout(r, 200));
  const checked = await page.eval(`__t.settingsCheckbox(${JSON.stringify(label)}).checked`);
  await page.eval(`document.querySelector('.settings-modal .close-button').click(); true`);
  await new Promise((r) => setTimeout(r, 200));
  return checked;
}

/** Clears the combine result, then combines the given 0-based column indexes in this order. */
export async function combineColumns(page, indexes) {
  await page.eval(`__t.page().querySelector('.combine-clear')?.click(); true`);
  await new Promise((r) => setTimeout(r, 200));
  await page.eval(`document.querySelector('.combine-icon-link').click(); true`);
  await new Promise((r) => setTimeout(r, 300));
  for (const i of indexes) {
    await page.eval(`document.querySelectorAll('.column-button')[${i}]?.click(); true`);
    await new Promise((r) => setTimeout(r, 300));
  }
  const used = await page.eval(`document.querySelectorAll('.column-button-used').length`);
  await page.eval(`document.querySelector('.close-combine-btn')?.click(); true`);
  await new Promise((r) => setTimeout(r, 200));
  return { used, text: await page.eval('__t.combined()') };
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Error handling of Filter and Remove (Paket 4) in the current processing mode:
 * invalid regex -> one error message, no success message, previous result kept, processing finished;
 * all lines removed -> empty result reported as success. `errorsSince(n)` returns console errors since log index n.
 */
export async function checkProcessingErrors(page, r, label, errorsSince) {
  const result = () => page.eval(`__t.textareas()[1]?.value ?? null`);
  const finished = () => page.eval(`!!__t.page().querySelector('.mode-toggle')`); // only rendered when not processing
  const setPattern = async (value) => {
    await page.eval(`__t.set(__t.page().querySelector('.form-add-render input'), ${JSON.stringify(value)}); true`);
    await sleepMs(150);
  };
  /** Clicks, waits for the first snackbar and returns all snackbars shown meanwhile */
  const run = async (clickExpr) => {
    await page.eval(`__t.watchSnacks(); ${clickExpr}; true`);
    await page.waitFor(`__t.snackLog.length > 0`, 8000);
    await sleepMs(300);
    return page.eval('__t.takeSnacks()');
  };
  const isRegexError = (snacks) => snacks.length === 1 && /^error: .*(regex|regul)/i.test(snacks[0]);

  // --- Filter ---
  const filterKeep = `__t.page().querySelectorAll('.filter-actions button')[1].click()`;
  await page.eval(`__t.nav('filter'); true`);
  await sleepMs(200);
  await page.eval(`__t.set(__t.textareas()[0], 'apple\\nbanana\\napricot'); true`);
  await sleepMs(150);
  await setPattern('ap');
  let snacks = await run(filterKeep);
  const filterBefore = await result();
  r.check(`${label}: Filter valid result`, filterBefore === 'ap\nap' && snacks.every((s) => s.startsWith('success')), `${JSON.stringify(filterBefore)} ${JSON.stringify(snacks)}`);

  let n = page.logs.length;
  await setPattern('([a-');
  snacks = await run(filterKeep);
  r.check(`${label}: Filter invalid regex -> one error message, no success message`, isRegexError(snacks), JSON.stringify(snacks));
  r.check(`${label}: Filter invalid regex -> previous result kept`, (await result()) === filterBefore, JSON.stringify(await result()));
  r.check(`${label}: Filter invalid regex -> processing finished, no console error`, (await finished()) && errorsSince(n).length === 0, JSON.stringify(errorsSince(n)));

  n = page.logs.length;
  await setPattern('zzz');
  snacks = await run(filterKeep);
  r.check(
    `${label}: Filter removing all lines -> empty result reported as success`,
    (await result()) === '' && snacks.length === 1 && snacks[0].startsWith('success') && errorsSince(n).length === 0,
    `${JSON.stringify(await result())} ${JSON.stringify(snacks)}`
  );
  await setPattern('');

  // --- Remove ---
  const regexCheckbox = `[...__t.page().querySelectorAll('.input-box')].find(e => /regex/i.test(e.innerText)).querySelector('input')`;
  const removeContaining = `__t.page().querySelector('.remove-action-button.containing').click()`;
  await page.eval(`__t.nav('remove'); true`);
  await sleepMs(200);
  await page.eval(`__t.set(__t.textareas()[0], 'x\\ny\\nx\\nz'); true`);
  await sleepMs(150);
  snacks = await run(`__t.page().querySelector('.remove-action-button.duplicates').click()`);
  const removeBefore = await result();
  r.check(`${label}: Remove valid result`, removeBefore === 'x\ny\nz', JSON.stringify(removeBefore));

  await page.eval(`${regexCheckbox}.checked || ${regexCheckbox}.click(); true`);
  await sleepMs(150);
  n = page.logs.length;
  await setPattern('([a-');
  snacks = await run(removeContaining);
  r.check(`${label}: Remove invalid regex -> one error message, no success message`, isRegexError(snacks), JSON.stringify(snacks));
  r.check(`${label}: Remove invalid regex -> previous result kept`, (await result()) === removeBefore, JSON.stringify(await result()));
  r.check(`${label}: Remove invalid regex -> processing finished, no console error`, (await finished()) && errorsSince(n).length === 0, JSON.stringify(errorsSince(n)));

  n = page.logs.length;
  await setPattern('x|y|z');
  snacks = await run(removeContaining);
  r.check(
    `${label}: Remove removing all lines -> empty result reported as success`,
    (await result()) === '' && snacks.length === 1 && snacks[0].startsWith('success') && /4/.test(snacks[0]) && errorsSince(n).length === 0,
    `${JSON.stringify(await result())} ${JSON.stringify(snacks)}`
  );
  await page.eval(`${regexCheckbox}.checked && ${regexCheckbox}.click(); true`);
  await setPattern('');
}
