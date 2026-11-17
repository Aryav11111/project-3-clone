(() => {
  const history = [];
  let busy = false;

  const root = document.createElement('div');
  root.className = 'chat';
  root.innerHTML = `
    <div class="chat-panel" id="chatPanel" hidden>
      <div class="chat-head">
        <strong>Drink helper</strong>
        <button type="button" class="chat-close" aria-label="Close">✕</button>
      </div>
      <p class="chat-intro">Tell me what you're craving and I'll suggest something from our menu.</p>
      <div class="chat-log" translate="no" aria-live="polite"></div>
      <div class="chat-suggestions">
        <button type="button">Something fruity</button>
        <button type="button">Not too sweet</button>
        <button type="button">I need caffeine</button>
        <button type="button">What's good today?</button>
      </div>
      <form class="chat-form">
        <input type="text" maxlength="500" placeholder="I'm in the mood for…" aria-label="Message" autocomplete="off" />
        <button type="submit">Send</button>
      </form>
    </div>
    <button class="chat-toggle" type="button" aria-expanded="false" aria-controls="chatPanel">🧋 Help me choose</button>`;
  document.body.append(root);

  const panel = root.querySelector('.chat-panel');
  const toggle = root.querySelector('.chat-toggle');
  const log = root.querySelector('.chat-log');
  const form = root.querySelector('.chat-form');
  const input = form.querySelector('input');
  const sendBtn = form.querySelector('button');

  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) input.focus();
  }

  toggle.addEventListener('click', () => setOpen(panel.hidden));
  root.querySelector('.chat-close').addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) setOpen(false); });

  root.querySelector('.chat-suggestions').addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') send(e.target.textContent);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    send(input.value);
  });

  function pickDrink(id) {
    if (typeof openDrink !== 'function' || typeof menu === 'undefined' || !menu.some((d) => d.id === id)) return;
    setOpen(false);
    openDrink(id);
  }

  function addMessage(role, text, items = []) {
    const bubble = document.createElement('div');
    bubble.className = `chat-msg ${role}`;
    const p = document.createElement('p');
    p.textContent = text;
    bubble.append(p);
    for (const item of items) {
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'chat-pick';
      const name = document.createElement('span');
      name.textContent = item.name;
      const price = document.createElement('span');
      price.className = 'price';
      price.textContent = '$' + Number(item.price).toFixed(2);
      pick.append(name, price);
      pick.addEventListener('click', () => pickDrink(item.id));
      bubble.append(pick);
    }
    log.append(bubble);
    log.scrollTop = log.scrollHeight;
    return bubble;
  }

  async function send(text) {
    text = text.trim();
    if (!text || busy) return;
    busy = true;
    sendBtn.disabled = true;
    input.value = '';

    addMessage('user', text);
    history.push({ role: 'user', content: text });
    const typing = addMessage('assistant typing', '…');

    const language = document.getElementById('siteLanguage')?.value || 'en';
    const temperature = parseInt(document.getElementById('temp')?.textContent, 10);

    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(25000),
        body: JSON.stringify({
          messages: history.slice(-10),
          language,
          temperature: Number.isFinite(temperature) ? temperature : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The assistant is unavailable right now.');
      typing.remove();
      addMessage('assistant', data.reply, data.items);
      const picks = data.items.length ? `\n[Recommended: ${data.items.map((d) => d.name).join(', ')}]` : '';
      history.push({ role: 'assistant', content: data.reply + picks });
    } catch (err) {
      typing.remove();
      history.pop();
      addMessage('error', err.name === 'TimeoutError' ? 'That took too long. Please try again.' : err.message);
    } finally {
      busy = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }
})();
