'use strict';

const form = document.querySelector('#lookup-form');
const input = document.querySelector('#student-id');
const errorBox = document.querySelector('#form-error');
const result = document.querySelector('#result');
const statusGrid = document.querySelector('#status-grid');
const maskedId = document.querySelector('#masked-id');
const submitButton = form.querySelector('button[type="submit"]');

const statusCopy = {
  complete: { label: 'Completed', labelKo: '완료', icon: '✓' },
  incomplete: { label: 'Not completed', labelKo: '미완료', icon: '!' },
  pending: { label: 'Data pending', labelKo: '데이터 대기', icon: '–' }
};

function renderStatuses(data) {
  maskedId.textContent = data.studentId;
  statusGrid.replaceChildren();

  for (const survey of data.surveys) {
    const copy = statusCopy[survey.status];
    const card = document.createElement('article');
    card.className = `status-card status-${survey.status}`;

    const icon = document.createElement('span');
    icon.className = 'status-icon';
    icon.textContent = copy.icon;
    icon.setAttribute('aria-hidden', 'true');

    const names = document.createElement('div');
    const title = document.createElement('h4');
    title.textContent = survey.label;
    const korean = document.createElement('p');
    korean.lang = 'ko';
    korean.textContent = survey.labelKo;
    names.append(title, korean);

    const badge = document.createElement('div');
    badge.className = 'status-badge';
    const badgeLabel = document.createElement('strong');
    badgeLabel.textContent = copy.label;
    const badgeKo = document.createElement('span');
    badgeKo.lang = 'ko';
    badgeKo.textContent = copy.labelKo;
    badge.append(badgeLabel, badgeKo);

    card.append(icon, names, badge);
    statusGrid.append(card);
  }

  result.hidden = false;
  result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.textContent = '';
  result.hidden = true;
  const studentId = input.value.trim();

  if (!/^[a-zA-Z0-9-]{4,32}$/.test(studentId)) {
    errorBox.textContent = 'Enter a valid student ID using letters or numbers.';
    input.focus();
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = 'Checking…';

  try {
    const response = await fetch('/api/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not check your status.');
    renderStatuses(data);
  } catch (error) {
    errorBox.textContent = error.message;
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = 'Check status <span aria-hidden="true">→</span>';
  }
});
