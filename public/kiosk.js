const SUGAR = ['0%', '25%', '50%', '75%', '100%'];
const ICE = ['No ice', 'Less ice', 'Regular ice'];
const PAYMENTS = ['Credit Card', 'Campus Card', 'Cash'];

let menu = [];
let cart = [];
let category = 'All';
let drink = null;
let choice = { sugar: 4, ice: 2 };
let payment = 'Credit Card';
let todaysPick = null;

const $ = (id) => document.getElementById(id);
const money = (n) => '$' + Number(n).toFixed(2);

function show(page) {
  document.querySelectorAll('section').forEach((s) => s.classList.toggle('on', s.id === page));
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.page === page));
  if (page === 'checkout') renderCheckout();
  window.scrollTo(0, 0);
}

document.addEventListener('click', (e) => {
  const page = e.target.closest('[data-page]');
  if (page) show(page.dataset.page);
});

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
    $('drinks').innerHTML = `<p class="error">Could not load the menu: ${err.message}</p>`;
    return;
  }
  renderMenu();
}

function randomChar() {
  return "789ABCDEF"[Math.floor(Math.random() * 9)];
}

function renderMenu() {
  const categories = ['All', ...new Set(menu.map((d) => d.category))];
  $('categories').innerHTML = categories
    .map((c) => `<button class="${c === category ? 'on' : ''}" data-category="${c}">${c}</button>`)
    .join('');

  const shown = menu.filter((d) => category === 'All' || d.category === category);
  $('drinks').innerHTML = shown.map((d) => `
    <button class="drink" data-id="${d.id}">
      <span class="drink-description">
        <span>
          <span class="drink-name">${d.name}</span>${todaysPick && d.id === todaysPick.id ? '<span class="tag">TODAY</span>' : ''}
          <small>${d.category}</small>
        </span>
        <span class="price">${money(d.price)}</span>
      </span>
      <img class="drink-image" src="${"images/" + (Object.hasOwn(d, "image") ? d.image : randomChar() + randomChar() + randomChar() + ".png")}">
    </button>`).join('');
}

$('categories').addEventListener('click', (e) => {
  if (!e.target.dataset.category) return;
  category = e.target.dataset.category;
  renderMenu();
});

$('drinks').addEventListener('click', (e) => {
  const button = e.target.closest('.drink');
  if (button) openDrink(Number(button.dataset.id));
});

async function loadWeather() {
  try {
    const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=30.628&longitude=-96.334&current=temperature_2m&temperature_unit=fahrenheit');
    const temp = Math.round((await res.json()).current.temperature_2m);
    const word = temp >= 85 ? 'blended' : temp >= 70 ? 'mango' : temp >= 55 ? 'classic' : 'taro';
    todaysPick = menu.find((d) => d.name.toLowerCase().includes(word)) || menu[0];
    $('temp').textContent = `${temp}°F`;
    $('weatherText').innerHTML = `It's ${temp}°F in College Station. Today we'd pour the <b>${todaysPick.name}</b>.`;
    renderMenu();
  } catch {
    $('weatherText').textContent = "Couldn't get the weather. You can't go wrong with a Classic Pearl Milk Tea.";
  }
}

function openDrink(id) {
  drink = menu.find((d) => d.id === id);
  choice = { sugar: 4, ice: 2 };
  $('drinkName').textContent = drink.name;
  $('drinkPrice').textContent = money(drink.price);
  renderOptions();
  show('customize');
}

function renderOptions() {
  $('sugarOptions').innerHTML = SUGAR.map((s, i) => `<button class="${choice.sugar === i ? 'on' : ''}" data-sugar="${i}">${s}</button>`).join('');
  $('iceOptions').innerHTML = ICE.map((s, i) => `<button class="${choice.ice === i ? 'on' : ''}" data-ice="${i}">${s}</button>`).join('');
}

$('customize').addEventListener('click', (e) => {
  const { sugar, ice } = e.target.dataset;
  if (sugar) choice.sugar = Number(sugar);
  if (ice) choice.ice = Number(ice);
  if (sugar || ice) renderOptions();
});

$('addBtn').addEventListener('click', () => {
  cart.push({ id: drink.id, name: drink.name, price: drink.price, ...choice });
  $('cartCount').textContent = cart.length;
  show('menu');
});

function renderCheckout() {
  const total = cart.reduce((sum, item) => sum + item.price, 0);
  $('receipt').innerHTML = cart.length === 0 ? 'Your cart is empty.' : cart.map((item, i) => `
    <div class="line">
      <span>${item.name}<small>${SUGAR[item.sugar]} sugar · ${ICE[item.ice]}</small></span>
      <span>${money(item.price)}<button data-remove="${i}">✕</button></span>
    </div>`).join('') + `<div class="line total"><span>TOTAL</span><span>${money(total)}</span></div>`;
  $('paymentOptions').innerHTML = PAYMENTS.map((p) => `<button class="${p === payment ? 'on' : ''}" data-payment="${p}">${p}</button>`).join('');
  $('payBtn').disabled = cart.length === 0;
  $('payError').textContent = '';
}

$('checkout').addEventListener('click', (e) => {
  if (e.target.dataset.remove) {
    cart.splice(Number(e.target.dataset.remove), 1);
    $('cartCount').textContent = cart.length;
    renderCheckout();
  }
  if (e.target.dataset.payment) {
    payment = e.target.dataset.payment;
    renderCheckout();
  }
});

$('payBtn').addEventListener('click', async () => {
  try {
    const result = await api('/api/orders', 'POST', { items: cart, payment });
    cart = [];
    $('cartCount').textContent = 0;
    $('orderNumber').textContent = result.orderId;
    show('done');
  } catch (err) {
    $('payError').textContent = err.message;
  }
});

loadMenu().then(loadWeather);
