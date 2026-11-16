// DeepL credentials stay on the server. English is the original page language.
module.exports = function installTranslation(app) {
  const targets = { es: 'ES', fr: 'FR', ja: 'JA', zh: 'ZH' };
  const cache = new Map();
  let windowStart = Date.now();
  let characters = 0;

  app.post('/api/translate', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { texts, language } = req.body || {};
    if (!Array.isArray(texts) || texts.length < 1 || texts.length > 50 ||
        texts.some((s) => typeof s !== 'string' || !s.trim() || s.length > 2000) ||
        texts.join('').length > 10000 || !['en', ...Object.keys(targets)].includes(language)) {
      return res.status(400).json({ error: 'Invalid translation request.' });
    }
    if (language === 'en') return res.json({ translations: texts });
    const key = process.env.DEEPL_API_KEY?.trim();
    if (!key) return res.status(503).json({ error: 'Translation is not configured. Please use English for now.' });
    const missing = [...new Set(texts)].filter((text) => !cache.has(`${language}:${text}`));
    if (Date.now() - windowStart >= 3600000) { characters = 0; windowStart = Date.now(); }
    const size = missing.join('').length;
    // Bound public API usage per server instance; cached translations cost nothing.
    if (characters + size > 60000) return res.status(429).json({ error: 'Translation is busy. Please try again later.' });
    characters += size;
    try {
      if (missing.length) {
        const host = key.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';
        const response = await fetch(`https://${host}/v2/translate`, {
          method: 'POST', signal: AbortSignal.timeout(15000),
          headers: { Authorization: `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: missing, source_lang: 'EN', target_lang: targets[language] }),
        });
        if (!response.ok) {
          console.error(`DeepL translation failed: HTTP ${response.status}`);
          return res.status(502).json({ error: 'Translation is unavailable. Please try again later.' });
        }
        const data = await response.json();
        if (!Array.isArray(data.translations) || data.translations.length !== missing.length ||
            data.translations.some((item) => typeof item.text !== 'string')) throw new Error('Invalid response');
        data.translations.forEach((item, i) => {
          if (cache.size >= 5000) cache.delete(cache.keys().next().value);
          cache.set(`${language}:${missing[i]}`, item.text);
        });
      }
      res.json({ translations: texts.map((text) => cache.get(`${language}:${text}`)) });
    } catch {
      console.error('DeepL translation failed: network, timeout, or invalid response');
      res.status(502).json({ error: 'Translation is unavailable. Please try again later.' });
    }
  });
};
