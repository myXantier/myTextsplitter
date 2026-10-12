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
