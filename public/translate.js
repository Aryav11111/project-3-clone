(() => {
  const languages = { en: 'English', es: 'Español', fr: 'Français', ja: '日本語', zh: '中文（简体）' };
  const storageKey = 'boba-language';
  let language = 'en';
  try { const saved = localStorage.getItem(storageKey); if (languages[saved]) language = saved; } catch {}
  const toolbar = document.createElement('div');
  toolbar.className = 'language-toolbar';
  toolbar.setAttribute('translate', 'no');
  const label = document.createElement('label');
  label.htmlFor = 'siteLanguage';
  label.textContent = 'Language / Idioma / Langue / 言語 / 语言';
  const select = document.createElement('select');
  select.id = 'siteLanguage';
  Object.entries(languages).forEach(([value, name]) => select.add(new Option(name, value)));
  select.value = language;
  const status = document.createElement('span');
  status.className = 'language-status';
  status.setAttribute('role', 'status');
  toolbar.append(label, select, status);
  document.body.prepend(toolbar);

  // Retain each original string so switching languages never translates a translation.
  const originals = new WeakMap();
  const cache = new Map();
  const excluded = 'script,style,svg,textarea,input,code,[translate="no"],.brand,#accountName,#accountEmail,#table,#fields,#orders-container';
  let version = 0;
  let timer;
  let running = false;
  let dirty = false;
  let failed = false;
  const observer = new MutationObserver((changes) => {
    if (changes.some(({ target }) => !toolbar.contains(target))) schedule();
  });
  const observe = () => observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  function schedule() {
    if (failed) return;
    clearTimeout(timer);
    timer = setTimeout(translatePage, 150);
  }
  function entries() {
    const result = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement.closest(excluded) || !/\p{L}/u.test(node.data)) continue;
      let original = originals.get(node);
      if (!original || node.data !== original.last) {
        original = { source: node.data, last: node.data };
        originals.set(node, original);
      }
      result.push({ node, original });
    }
    return result;
  }
  async function translatePage() {
    if (running) { dirty = true; return; }
    running = true;
    dirty = false;
    const current = version;
    const target = language;
    const items = entries();
    try {
      if (target !== 'en') {
        status.textContent = 'Translating…';
        const missing = [...new Set(items.map(({ original }) => original.source.trim()))]
          .filter((text) => !cache.has(`${target}:${text}`));
        // Small batches stay below DeepL and local request size limits.
        while (missing.length && current === version) {
          const batch = [];
          let length = 0;
          while (missing.length && batch.length < 20 && length + missing[0].length <= 10000) {
            const text = missing.shift(); length += text.length; batch.push(text);
          }
          if (!batch.length) throw new Error('A page text is too long to translate.');
          const response = await fetch('/api/translate', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(20000), body: JSON.stringify({ texts: batch, language: target }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'Translation is unavailable.');
          if (!Array.isArray(data.translations) || data.translations.length !== batch.length ||
              data.translations.some((text) => typeof text !== 'string')) throw new Error('Invalid translation response.');
          batch.forEach((text, i) => cache.set(`${target}:${text}`, data.translations[i]));
        }
      }
      if (current !== version) return;
      observer.disconnect();
      for (const { node, original } of items) {
        if (!node.isConnected || node.data !== original.last) { dirty = true; continue; }
        const translated = target === 'en' ? original.source : original.source.replace(original.source.trim(), cache.get(`${target}:${original.source.trim()}`));
        node.data = translated;
        original.last = translated;
      }
      document.documentElement.lang = target === 'zh' ? 'zh-Hans' : target;
      status.textContent = '';
    } catch (err) {
      if (current === version) {
        failed = true;
        status.textContent = `${err.name === 'TimeoutError' ? 'Translation timed out.' : err.message} Select English or reselect a language to retry.`;
      }
    } finally {
      observe();
      running = false;
      if (current !== version || dirty) schedule();
    }
  }
  select.addEventListener('change', () => {
    language = select.value;
    version++;
    failed = false;
    try { localStorage.setItem(storageKey, language); } catch {}
    schedule();
  });
  observe();
  schedule();
})();
