const $ = (id) => document.getElementById(id);

async function api(url, method = 'GET', body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  const data = await res.json();
  if (res.status === 401) showLogin('Your session has expired. Please sign in again.');
  if (!res.ok) throw new Error(data.error);
  return data;
}

let table = 'menu_items';
let tableData = { cols: [], rows: [] };
let selected = null;

async function loadTable() {
  try {
    tableData = await api(`/api/manage/${table}`);
  } catch (err) {
    $('table').innerHTML = `<tr><td class="error">Could not load: ${err.message}</td></tr>`;
    return;
  }
  selected = null;
  renderTable();
  renderEditor();
}

function renderTable() {
  const { cols, rows } = tableData;
  $('table').innerHTML = `
    <thead><tr><th>ID</th>${cols.map((c) => `<th>${c.replace('_', ' ')}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `
      <tr data-id="${r.id}" class="${selected && selected.id === r.id ? 'on' : ''}">
        <td>${r.id}</td>${cols.map((c) => `<td>${r[c] ?? ''}</td>`).join('')}
      </tr>`).join('')}
    </tbody>`;
}

function renderEditor() {
  $('editorTitle').textContent = selected ? `Edit #${selected.id}` : 'New row';
  $('fields').innerHTML = tableData.cols.map((c) => `
    <label>${c.replace('_', ' ')}
      <input name="${c}" type="${c === 'hire_date' ? 'date' : 'text'}" value="${selected ? selected[c] ?? '' : ''}" />
    </label>`).join('');
  $('deleteBtn').style.display = selected ? '' : 'none';
  $('editorError').textContent = '';
}

$('tabs').addEventListener('click', (e) => {
  if (!e.target.dataset.table) return;
  table = e.target.dataset.table;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b === e.target));
  loadTable();
});

$('table').addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-id]');
  if (!row) return;
  selected = tableData.rows.find((r) => r.id === Number(row.dataset.id));
  renderTable();
  renderEditor();
});

$('newBtn').addEventListener('click', () => {
  selected = null;
  renderTable();
  renderEditor();
});

$('saveBtn').addEventListener('click', async () => {
  const values = {};
  document.querySelectorAll('#fields input').forEach((input) => (values[input.name] = input.value));
  try {
    if (selected) await api(`/api/manage/${table}/${selected.id}`, 'PUT', values);
    else await api(`/api/manage/${table}`, 'POST', values);
    await loadTable();
  } catch (err) {
    $('editorError').textContent = err.message;
  }
});

$('deleteBtn').addEventListener('click', async () => {
  if (!confirm(`Delete ${Object.values(selected)[1]}?`)) return;
  try {
    await api(`/api/manage/${table}/${selected.id}`, 'DELETE');
    await loadTable();
  } catch (err) {
    $('editorError').textContent = err.message;
  }
});

function showLogin(message) {
  $('managerContent').hidden = true;
  $('loginPanel').hidden = false;
  $('authStatus').textContent = message;
  $('googleLogin').hidden = false;
  $('table').replaceChildren();
  $('fields').replaceChildren();
  selected = null;
}

const authErrors = {
  configuration: 'Google login needs to be configured by the administrator.',
  invalid: 'This sign-in request expired or was invalid. Please try again.',
  cancelled: 'Sign-in was cancelled. You can try again.',
  denied: 'This Google account is not authorized for manager access.',
  failed: 'Google sign-in could not be completed. Please try again.',
};

async function restoreSession() {
  const params = new URLSearchParams(location.search);
  const authError = params.get('auth_error');
  if (authError) {
    params.delete('auth_error');
    history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
  }
  try {
    const { user, configured } = await api('/api/auth/me');
    if (!user) {
      showLogin(authErrors[authError] || (configured ? 'Sign in to manage the shop.' : authErrors.configuration));
      $('googleLogin').hidden = !configured;
      return;
    }
    $('accountName').textContent = user.name;
    $('accountEmail').textContent = user.email;
    $('loginPanel').hidden = true;
    $('managerContent').hidden = false;
    await loadTable();
  } catch (err) {
    showLogin(err.message || 'Could not check your session. Please reload to try again.');
  }
}

$('logoutBtn').addEventListener('click', async () => {
  $('logoutBtn').disabled = true;
  try {
    await api('/api/auth/logout', 'POST');
    showLogin('You have signed out.');
    $('accountName').textContent = '';
    $('accountEmail').textContent = '';
  } catch (err) {
    $('editorError').textContent = err.message;
  } finally {
    $('logoutBtn').disabled = false;
  }
});

restoreSession();
