module.exports = function installAssistant(app, pool) {
  const languages = { en: 'English', es: 'Spanish', fr: 'French', ja: 'Japanese', zh: 'Simplified Chinese' };
  const HOURLY_LIMIT = 300; 
  let windowStart = Date.now();
  let requests = 0;

  const schema = {
    type: 'object',
    properties: {
      reply: { type: 'string' },
      item_ids: { type: 'array', items: { type: 'integer' } },
    },
    required: ['reply', 'item_ids'],
    additionalProperties: false,
  };

  app.post('/api/assistant', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { messages, language = 'en', temperature } = req.body || {};
    if (!Array.isArray(messages) || messages.length < 1 || messages.length > 20 ||
        messages.some((m) => !m || !['user', 'assistant'].includes(m.role) ||
          typeof m.content !== 'string' || !m.content.trim() || m.content.length > 1000) ||
        messages[messages.length - 1].role !== 'user' || !languages[language]) {
      return res.status(400).json({ error: 'Invalid request.' });
    }

    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) return res.status(503).json({ error: 'The drink assistant is not set up yet.' });

    if (Date.now() - windowStart >= 3600000) { windowStart = Date.now(); requests = 0; }
    if (requests >= HOURLY_LIMIT) return res.status(429).json({ error: 'The assistant is busy. Please try again in a bit.' });
    requests++;

    let menu;
    try {
      ({ rows: menu } = await pool.query(
        'SELECT item_id AS id, name, category, price::float AS price FROM menu_items WHERE active ORDER BY item_id'
      ));
    } catch (err) {
      console.error('Assistant menu lookup failed:', err.message);
      return res.status(503).json({ error: 'Could not load the menu. Please try again.' });
    }
    if (!menu.length) return res.status(503).json({ error: 'The menu is empty right now.' });

    const system = [
      'You are the friendly ordering assistant on the self-service kiosk at Boba Lounge, a boba tea shop near Texas A&M.',
      'Help customers choose drinks.',
      '',
      'Rules:',
      '- Recommend only drinks from the MENU below, using their exact ids in item_ids. Never invent drinks, prices, ingredients or toppings.',
      '- Put 1 to 3 drinks in item_ids, best match first. Use an empty list when you are not recommending anything (greetings, off-topic questions).',
      '- Every drink can be customized with sugar (0%, 25%, 50%, 75%, 100%) and ice (no ice, less ice, regular ice). You may suggest settings.',
      '- Keep the reply under 60 words, warm and casual. Do not list prices in the reply; the kiosk shows them under your message.',
      '- You cannot place orders or take payment. The customer taps a recommended drink to customize it and add it to the cart.',
      '- If asked about something unrelated to the shop, briefly steer back to drinks.',
      `- Write the reply in ${languages[language]}.`,
      Number.isFinite(temperature) ? `\nIt is currently ${Math.round(temperature)}°F in College Station, TX.` : '',
      '',
      'MENU (id | name | category | price):',
      ...menu.map((d) => `${d.id} | ${d.name} | ${d.category} | $${d.price.toFixed(2)}`),
    ].join('\n');

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: system },
            ...messages.slice(-10).map(({ role, content }) => ({ role, content: content.trim() })),
          ],
          response_format: { type: 'json_schema', json_schema: { name: 'drink_recommendation', strict: true, schema } },
          max_completion_tokens: 600,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        console.error(`OpenAI request failed: HTTP ${response.status}; ${data.error?.code || data.error?.type || 'unknown'}`);
        return res.status(502).json({ error: 'The assistant is unavailable right now. Please try again.' });
      }

      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('empty response');
      const parsed = JSON.parse(content);
      if (typeof parsed.reply !== 'string' || !Array.isArray(parsed.item_ids)) throw new Error('bad shape');

      const byId = new Map(menu.map((d) => [d.id, d]));
      const items = [...new Set(parsed.item_ids)].filter((id) => byId.has(id)).slice(0, 3).map((id) => byId.get(id));
      res.json({ reply: parsed.reply.trim(), items });
    } catch (err) {
      console.error(`OpenAI request failed: ${err.name === 'TimeoutError' ? 'timeout' : err.message}`);
      res.status(502).json({ error: 'The assistant is unavailable right now. Please try again.' });
    }
  });
};
