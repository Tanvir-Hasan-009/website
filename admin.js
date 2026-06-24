'use strict';

const loginPanel = document.querySelector('#login-panel');
const loginForm = document.querySelector('#login-form');
const passwordInput = document.querySelector('#admin-password');
const loginError = document.querySelector('#login-error');
const dashboard = document.querySelector('#dashboard');
const datasetGrid = document.querySelector('#dataset-grid');
const signOut = document.querySelector('#sign-out');
const toast = document.querySelector('#toast');

let password = sessionStorage.getItem('surveyAdminPassword') || '';

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      'X-Admin-Password': password,
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Request failed.'), { status: response.status });
  return data;
}

function showToast(message, tone = 'success') {
  toast.textContent = message;
  toast.className = `toast toast-${tone}`;
  toast.hidden = false;
  window.setTimeout(() => { toast.hidden = true; }, 4200);
}

function dateLabel(value) {
  if (!value) return 'Never uploaded';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function decodeFile(buffer, mode) {
  if (mode !== 'auto') return new TextDecoder(mode).decode(buffer);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('euc-kr').decode(buffer);
  }
}

function createDatasetCard(dataset) {
  const card = document.createElement('article');
  card.className = 'dataset-card';

  const top = document.createElement('div');
  top.className = 'dataset-top';
  const monogram = document.createElement('span');
  monogram.className = 'dataset-monogram';
  monogram.textContent = dataset.short;
  const state = document.createElement('span');
  state.className = `dataset-state ${dataset.uploaded ? 'is-live' : ''}`;
  state.textContent = dataset.uploaded ? 'Live' : 'No data';
  top.append(monogram, state);

  const heading = document.createElement('div');
  heading.className = 'dataset-title';
  const title = document.createElement('h3');
  title.textContent = dataset.label;
  const titleKo = document.createElement('p');
  titleKo.lang = 'ko';
  titleKo.textContent = dataset.labelKo;
  heading.append(title, titleKo);

  const stats = document.createElement('div');
  stats.className = 'dataset-stats';
  stats.innerHTML = `<div><strong>${dataset.uploaded ? dataset.recordCount.toLocaleString() : '—'}</strong><span>valid rows</span></div><div><strong>${dateLabel(dataset.updatedAt)}</strong><span>last updated</span></div>`;

  const form = document.createElement('form');
  form.className = 'upload-form';
  const fileLabel = document.createElement('label');
  fileLabel.textContent = 'Completed-student CSV';
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.csv,text/csv';
  file.required = true;
  fileLabel.append(file);

  const controls = document.createElement('div');
  controls.className = 'upload-controls';
  const encoding = document.createElement('select');
  encoding.setAttribute('aria-label', 'CSV text encoding');
  encoding.innerHTML = '<option value="auto">Auto encoding</option><option value="utf-8">UTF-8</option><option value="euc-kr">Korean (EUC-KR)</option>';
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = dataset.uploaded ? 'Replace CSV' : 'Upload CSV';
  controls.append(encoding, submit);
  form.append(fileLabel, controls);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!file.files[0]) return;
    if (file.files[0].size > 5 * 1024 * 1024) {
      showToast('The CSV must be smaller than 5 MB.', 'error');
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Importing…';
    try {
      const buffer = await file.files[0].arrayBuffer();
      const csvText = decodeFile(buffer, encoding.value);
      const result = await api('/api/admin/import', {
        method: 'POST',
        body: JSON.stringify({
          datasetKey: dataset.key,
          fileName: file.files[0].name,
          csvText
        })
      });
      const statusNote = result.detected.statusColumn ? ` Status: ${result.detected.statusColumn}.` : ' Every listed ID was marked complete.';
      showToast(`Imported ${result.stats.completedRows} completed IDs.${statusNote}`);
      await loadDashboard();
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      submit.disabled = false;
      submit.textContent = dataset.uploaded ? 'Replace CSV' : 'Upload CSV';
    }
  });

  card.append(top, heading, stats, form);

  if (dataset.uploaded) {
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'clear-button';
    clear.textContent = 'Remove current data';
    clear.addEventListener('click', async () => {
      if (!window.confirm(`Remove the current ${dataset.label} data? Student results will show “Data pending.”`)) return;
      try {
        await api(`/api/admin/datasets/${encodeURIComponent(dataset.key)}`, { method: 'DELETE' });
        showToast('Dataset removed.');
        await loadDashboard();
      } catch (error) {
        showToast(error.message, 'error');
      }
    });
    card.append(clear);
  }

  return card;
}

async function loadDashboard() {
  const data = await api('/api/admin/summary');
  datasetGrid.replaceChildren(...data.datasets.map(createDatasetCard));
  loginPanel.hidden = true;
  dashboard.hidden = false;
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.textContent = '';
  password = passwordInput.value;
  try {
    await loadDashboard();
    sessionStorage.setItem('surveyAdminPassword', password);
    passwordInput.value = '';
  } catch (error) {
    password = '';
    sessionStorage.removeItem('surveyAdminPassword');
    loginError.textContent = error.message;
  }
});

signOut.addEventListener('click', () => {
  password = '';
  sessionStorage.removeItem('surveyAdminPassword');
  dashboard.hidden = true;
  loginPanel.hidden = false;
  passwordInput.focus();
});

if (password) {
  loadDashboard().catch(() => {
    password = '';
    sessionStorage.removeItem('surveyAdminPassword');
    loginPanel.hidden = false;
  });
}
