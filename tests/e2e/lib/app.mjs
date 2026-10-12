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
