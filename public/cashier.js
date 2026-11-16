const SUGAR = ['0%', '25%', '50%', '75%', '100%'];
const ICE = ['No ice', 'Less ice', 'Regular ice'];
const PAYMENTS = ['Credit Card', 'Campus Card', 'Cash'];

let menu = [];
let order = [];
let sugar = 4;
let ice = 2;
let payment = 'Credit Card';

const $ = (id) => document.getElementById(id);
const money = (n) => '$' + Number(n).toFixed(2);

async function api(url, method = 'GET', body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

async function loadMenu() {
  try {
    menu = await api('/api/menu');
  } catch (err) {
    $('menu').innerHTML = `<p class="error">Could not load the menu: ${err.message}</p>`;
    return;
  }
  const categories = [...new Set(menu.map((d) => d.category))];
  $('menu').innerHTML = categories.map((c) => `
    <section class="category on">
      <h2>${c}</h2>
      <div class="drink-grid">
        ${menu.filter((d) => d.category === c).map((d) => `
          <button data-id="${d.id}">${d.name}<span class="price">${money(d.price)}</span></button>`).join('')}
      </div>
    </section>`).join('');
}

function renderOptions() {
  $('sugarOptions').innerHTML = SUGAR.map((s, i) => `<button class="${i === sugar ? 'on' : ''}" data-sugar="${i}">${s}</button>`).join('');
  $('iceOptions').innerHTML = ICE.map((s, i) => `<button class="${i === ice ? 'on' : ''}" data-ice="${i}">${s}</button>`).join('');
  $('paymentOptions').innerHTML = PAYMENTS.map((p) => `<button class="${p === payment ? 'on' : ''}" data-payment="${p}">${p}</button>`).join('');
}

function renderOrder() {
  $('orderLines').innerHTML = order.length === 0
    ? '<div class="empty">Tap a drink to add it.</div>'
    : order.map((item, i) => `
      <div class="order-line">
        <span>${item.name}<small>${SUGAR[item.sugar]} sugar · ${ICE[item.ice]}</small></span>
        <span class="price">${money(item.price)}<button data-remove="${i}">✕</button></span>
      </div>`).join('');
  $('orderTotal').textContent = money(order.reduce((sum, item) => sum + item.price, 0));
  $('chargeBtn').disabled = order.length === 0;
}

function showMessage(text, ok) {
  $('message').textContent = text;
  $('message').className = 'message ' + (ok ? 'ok' : 'bad');
}

$('menu').addEventListener('click', (e) => {
  const button = e.target.closest('button[data-id]');
  if (!button) return;
  const drink = menu.find((d) => d.id === Number(button.dataset.id));
  order.push({ id: drink.id, name: drink.name, price: drink.price, sugar, ice });
  showMessage('', true);
  renderOrder();
});

document.querySelector('.ticket').addEventListener('click', (e) => {
  const { sugar: s, ice: i, payment: p, remove } = e.target.dataset;
  if (!s && !i && !p && !remove) return;
  if (s) sugar = Number(s);
  if (i) ice = Number(i);
  if (p) payment = p;
  if (remove) order.splice(Number(remove), 1);
  renderOptions();
  renderOrder();
});

$('clearBtn').addEventListener('click', () => {
  order = [];
  showMessage('', true);
  renderOrder();
});

$('chargeBtn').addEventListener('click', async () => {
  $('chargeBtn').disabled = true;
  try {
    const result = await api('/api/orders', 'POST', { items: order, payment });
    showMessage(`Order #${result.orderId} placed · ${money(result.total)}`, true);
    order = [];
    renderOrder();
  } catch (err) {
    showMessage(err.message, false);
    $('chargeBtn').disabled = false;
  }
});

renderOptions();
renderOrder();
loadMenu();
