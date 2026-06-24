'use strict';

const GRADE_SCALES = {
  '4.5': { 'A+': 4.5, A0: 4.0, 'B+': 3.5, B0: 3.0, 'C+': 2.5, C0: 2.0, 'D+': 1.5, D0: 1.0, F: 0 },
  '4.0': { 'A+': 4.0, A0: 3.7, 'B+': 3.3, B0: 3.0, 'C+': 2.3, C0: 2.0, 'D+': 1.3, D0: 1.0, F: 0 }
};

const accessPanel = document.querySelector('#grade-access');
const accessForm = document.querySelector('#grade-access-form');
const studentIdInput = document.querySelector('#grade-student-id');
const pinInput = document.querySelector('#grade-pin');
const accessError = document.querySelector('#grade-access-error');
const workspace = document.querySelector('#grade-workspace');
const maskedId = document.querySelector('#grade-masked-id');
const scaleSelect = document.querySelector('#grade-scale');
const newRecordNote = document.querySelector('#new-record-note');
const previousTermList = document.querySelector('#previous-term-list');
const totalCreditsRequiredInput = document.querySelector('#total-credits-required');
const creditsRemaining = document.querySelector('#credits-remaining');
const creditProgressCopy = document.querySelector('#credit-progress-copy');
const progressSaveStatus = document.querySelector('#progress-save-status');
const courseList = document.querySelector('#course-list');
const emptyCourses = document.querySelector('#empty-courses');
const addCourseButton = document.querySelector('#add-course');
const semestersRemainingInput = document.querySelector('#semesters-remaining');
const targetCgpaInput = document.querySelector('#target-cgpa');
const goalDetails = document.querySelector('#goal-details');
const futureCreditList = document.querySelector('#future-credit-list');
const goalProjection = document.querySelector('#goal-projection');
const goalResultIcon = document.querySelector('#goal-result-icon');
const goalResultTitle = document.querySelector('#goal-result-title');
const goalResultCopy = document.querySelector('#goal-result-copy');
const futureResultList = document.querySelector('#future-result-list');
const saveButton = document.querySelector('#save-grades');
const lockButton = document.querySelector('#lock-grades');
const saveStatus = document.querySelector('#save-status');
const saveError = document.querySelector('#grade-save-error');

let credentials = null;
let courses = [];
let previousTerms = [];
let totalCreditsRequired = '';
let goalPlan = { semestersRemaining: '', targetCgpa: '', futureCredits: [] };
let isNewRecord = false;
let progressSaveTimer = null;
let progressSaveVersion = 0;

function defaultTerm() {
  const now = new Date();
  return `${now.getFullYear()} ${now.getMonth() < 6 ? 'Spring' : 'Fall'}`;
}

async function postJson(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function calculateSummary() {
  const points = GRADE_SCALES[scaleSelect.value];
  let earned = 0;
  let gpaCredits = 0;
  let qualityPoints = 0;

  for (const course of courses) {
    const credits = Number(course.credits);
    if (!Number.isFinite(credits) || credits <= 0 || !course.grade) continue;
    if (course.grade === 'P') {
      earned += credits;
      continue;
    }
    if (course.grade === 'NP') continue;
    if (!Object.hasOwn(points, course.grade)) continue;
    gpaCredits += credits;
    qualityPoints += credits * points[course.grade];
    if (course.grade !== 'F') earned += credits;
  }

  let previousGpaCredits = 0;
  let previousEarnedCredits = 0;
  let previousQualityPoints = 0;
  for (const term of previousTerms) {
    const gpa = Number(term.gpa);
    const termGpaCredits = Number(term.gpaCredits);
    const termEarnedCredits = Number(term.earnedCredits);
    if (Number.isFinite(gpa) && gpa >= 0 && gpa <= Number(scaleSelect.value) && Number.isFinite(termGpaCredits) && termGpaCredits > 0) {
      previousGpaCredits += termGpaCredits;
      previousQualityPoints += gpa * termGpaCredits;
    }
    if (Number.isFinite(termEarnedCredits) && termEarnedCredits > 0) previousEarnedCredits += termEarnedCredits;
  }

  const currentGpa = gpaCredits ? qualityPoints / gpaCredits : null;
  const totalGpaCredits = previousGpaCredits + gpaCredits;
  const cgpa = totalGpaCredits ? (previousQualityPoints + qualityPoints) / totalGpaCredits : null;
  document.querySelector('#summary-cgpa').textContent = cgpa === null ? '—' : cgpa.toFixed(2);
  document.querySelector('#summary-current').textContent = currentGpa === null ? '—' : currentGpa.toFixed(2);
  document.querySelector('#summary-scale').textContent = `out of ${scaleSelect.value}`;
  const totalEarnedCredits = previousEarnedCredits + earned;
  document.querySelector('#summary-earned').textContent = formatCredits(totalEarnedCredits);
  document.querySelector('#summary-credits').textContent = formatCredits(totalGpaCredits);
  updateCreditRequirement(totalEarnedCredits);
  const summary = {
    totalGpaCredits,
    totalQualityPoints: previousQualityPoints + qualityPoints,
    totalEarnedCredits,
    cgpa
  };
  updateGoalProjection(summary);
  return summary;
}

function formatCredits(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function markUnsaved() {
  saveStatus.textContent = 'Unsaved changes · Changes are calculated instantly.';
  saveStatus.className = 'is-unsaved';
  saveError.textContent = '';
}

function makeInput(label, value, attributes = {}) {
  const input = document.createElement('input');
  input.setAttribute('aria-label', label);
  input.value = value ?? '';
  for (const [name, attributeValue] of Object.entries(attributes)) input.setAttribute(name, attributeValue);
  return input;
}

function renderCourses() {
  courseList.replaceChildren();
  emptyCourses.hidden = courses.length > 0;

  courses.forEach((course, index) => {
    const row = document.createElement('div');
    row.className = 'course-row';
    row.setAttribute('role', 'row');

    const name = makeInput(`Course ${index + 1} name`, course.name, { maxlength: '80', placeholder: 'Course name' });
    const term = makeInput(`Course ${index + 1} semester`, course.term, { maxlength: '40', placeholder: '2026 Spring' });
    const credits = makeInput(`Course ${index + 1} credits`, course.credits, { type: 'number', min: '0.5', max: '12', step: '0.5', inputmode: 'decimal' });
    const grade = document.createElement('select');
    grade.setAttribute('aria-label', `Course ${index + 1} grade`);
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Select';
    grade.append(blank);
    for (const gradeName of [...Object.keys(GRADE_SCALES[scaleSelect.value]), 'P', 'NP']) {
      const option = document.createElement('option');
      option.value = gradeName;
      option.textContent = gradeName;
      option.selected = course.grade === gradeName;
      grade.append(option);
    }

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-course';
    remove.setAttribute('aria-label', `Remove course ${index + 1}`);
    remove.textContent = '×';

    name.addEventListener('input', () => { course.name = name.value; markUnsaved(); });
    term.addEventListener('input', () => { course.term = term.value; markUnsaved(); });
    credits.addEventListener('input', () => { course.credits = credits.value; calculateSummary(); markUnsaved(); });
    grade.addEventListener('change', () => { course.grade = grade.value; calculateSummary(); markUnsaved(); });
    remove.addEventListener('click', () => {
      courses.splice(index, 1);
      renderCourses();
      calculateSummary();
      markUnsaved();
    });

    row.append(name, term, credits, grade, remove);
    courseList.append(row);
  });
  calculateSummary();
}

function renderPreviousTerms() {
  previousTermList.replaceChildren();

  previousTerms.forEach((term, index) => {
    const row = document.createElement('div');
    row.className = 'previous-row';
    row.setAttribute('role', 'row');

    const label = document.createElement('strong');
    label.className = 'semester-number';
    label.textContent = `Semester ${index + 1}`;
    const gpa = makeInput(`Previous semester ${index + 1} GPA`, term.gpa, { type: 'number', min: '0', max: scaleSelect.value, step: '0.01', inputmode: 'decimal', placeholder: '3.75' });
    const gpaCredits = makeInput(`Previous semester ${index + 1} GPA credits`, term.gpaCredits, { type: 'number', min: '0.5', max: '100', step: '0.5', inputmode: 'decimal', placeholder: '15' });
    const earnedCredits = makeInput(`Previous semester ${index + 1} earned credits`, term.earnedCredits, { type: 'number', min: '0', max: '100', step: '0.5', inputmode: 'decimal', placeholder: '16' });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-course';
    remove.setAttribute('aria-label', `Remove previous semester ${index + 1}`);
    remove.textContent = '×';

    gpa.addEventListener('input', () => { term.gpa = gpa.value; updatePreviousTerm(index); });
    gpaCredits.addEventListener('input', () => { term.gpaCredits = gpaCredits.value; updatePreviousTerm(index); });
    earnedCredits.addEventListener('input', () => { term.earnedCredits = earnedCredits.value; updatePreviousTerm(index); });
    remove.addEventListener('click', () => {
      previousTerms.splice(index, 1);
      ensureTrailingPreviousTerm();
      renderPreviousTerms();
      calculateSummary();
      markUnsaved();
      scheduleAcademicProgressSave();
    });

    row.append(label, gpa, gpaCredits, earnedCredits);
    if (hasPreviousTermInput(term) || index < previousTerms.length - 1) row.append(remove);
    else {
      const spacer = document.createElement('span');
      spacer.setAttribute('aria-hidden', 'true');
      row.append(spacer);
    }
    previousTermList.append(row);
  });
  calculateSummary();
}

function blankPreviousTerm(index) {
  return { id: crypto.randomUUID(), term: `Semester ${index + 1}`, gpa: '', gpaCredits: '', earnedCredits: '' };
}

function isPreviousTermComplete(term) {
  return term.gpa !== '' && term.gpaCredits !== '' && term.earnedCredits !== '';
}

function hasPreviousTermInput(term) {
  return term.gpa !== '' || term.gpaCredits !== '' || term.earnedCredits !== '';
}

function ensureTrailingPreviousTerm() {
  previousTerms.forEach((term, index) => { term.term = `Semester ${index + 1}`; });
  if (previousTerms.length === 0 || isPreviousTermComplete(previousTerms[previousTerms.length - 1])) {
    previousTerms.push(blankPreviousTerm(previousTerms.length));
  }
}

function updatePreviousTerm(index) {
  calculateSummary();
  markUnsaved();
  if (index === previousTerms.length - 1 && isPreviousTermComplete(previousTerms[index]) && previousTerms.length < 20) {
    previousTerms.push(blankPreviousTerm(previousTerms.length));
    renderPreviousTerms();
    const nextGpa = previousTermList.querySelector(`input[aria-label="Previous semester ${index + 2} GPA"]`);
    nextGpa?.focus();
  }
  scheduleAcademicProgressSave();
}

function addCourse() {
  courses.push({ id: crypto.randomUUID(), name: '', term: defaultTerm(), credits: 3, grade: '' });
  renderCourses();
  markUnsaved();
  const inputs = courseList.querySelectorAll('input[aria-label$="name"]');
  inputs[inputs.length - 1]?.focus();
}

function updateCreditRequirement(totalEarnedCredits) {
  const requirement = Number(totalCreditsRequired);
  if (totalCreditsRequired === '' || !Number.isFinite(requirement) || requirement <= 0) {
    creditsRemaining.textContent = '—';
    creditProgressCopy.textContent = `${formatCredits(totalEarnedCredits)} credits earned so far.`;
    return;
  }
  const remaining = Math.max(0, requirement - totalEarnedCredits);
  creditsRemaining.textContent = formatCredits(remaining);
  creditProgressCopy.textContent = `${formatCredits(totalEarnedCredits)} of ${formatCredits(requirement)} graduation credits completed.`;
}

function scheduleAcademicProgressSave() {
  window.clearTimeout(progressSaveTimer);
  progressSaveTimer = window.setTimeout(autoSaveAcademicProgress, 650);
}

async function autoSaveAcademicProgress() {
  if (!credentials) return;
  const incompleteTerm = previousTerms.find((term) => hasPreviousTermInput(term) && !isPreviousTermComplete(term));
  if (incompleteTerm) {
    progressSaveStatus.textContent = 'Finish the current semester row to save it automatically.';
    progressSaveStatus.className = 'progress-save-status is-waiting';
    return;
  }
  const requirement = totalCreditsRequired === '' ? null : Number(totalCreditsRequired);
  if (requirement !== null && (!Number.isFinite(requirement) || requirement < 1 || requirement > 400 || requirement * 2 % 1 !== 0)) {
    progressSaveStatus.textContent = 'Graduation credits must be between 1 and 400.';
    progressSaveStatus.className = 'progress-save-status is-error';
    return;
  }

  const version = ++progressSaveVersion;
  progressSaveStatus.textContent = 'Saving semester progress…';
  progressSaveStatus.className = 'progress-save-status is-saving';
  try {
    const saved = await postJson('/api/grades/progress', {
      ...credentials,
      scale: scaleSelect.value,
      previousTerms: previousTerms.filter(isPreviousTermComplete),
      totalCreditsRequired: requirement
    });
    if (version !== progressSaveVersion) return;
    isNewRecord = false;
    newRecordNote.hidden = true;
    progressSaveStatus.textContent = `Semester progress saved automatically at ${new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date(saved.updatedAt))}.`;
    progressSaveStatus.className = 'progress-save-status is-saved';
  } catch (error) {
    if (version !== progressSaveVersion) return;
    progressSaveStatus.textContent = error.message;
    progressSaveStatus.className = 'progress-save-status is-error';
  }
}

function renderFutureCredits() {
  futureCreditList.replaceChildren();
  const count = Number(goalPlan.semestersRemaining);
  if (!Number.isInteger(count) || count < 1 || count > 16) return;

  while (goalPlan.futureCredits.length < count) goalPlan.futureCredits.push('');
  goalPlan.futureCredits = goalPlan.futureCredits.slice(0, count);
  goalPlan.futureCredits.forEach((credit, index) => {
    const field = document.createElement('label');
    field.className = 'future-credit-field';
    const label = document.createElement('span');
    label.textContent = `Future semester ${index + 1}`;
    const input = makeInput(`Future semester ${index + 1} planned credits`, credit, {
      type: 'number', min: '0.5', max: '40', step: '0.5', inputmode: 'decimal', placeholder: '15'
    });
    input.addEventListener('input', () => {
      goalPlan.futureCredits[index] = input.value;
      calculateSummary();
      markUnsaved();
    });
    field.append(label, input);
    futureCreditList.append(field);
  });
}

function renderGoalPlanner() {
  semestersRemainingInput.value = goalPlan.semestersRemaining;
  targetCgpaInput.value = goalPlan.targetCgpa;
  targetCgpaInput.max = scaleSelect.value;
  const count = Number(goalPlan.semestersRemaining);
  const hasValidCount = Number.isInteger(count) && count >= 1 && count <= 16;
  goalDetails.hidden = !hasValidCount;
  if (hasValidCount) renderFutureCredits();
  else {
    futureCreditList.replaceChildren();
    goalProjection.hidden = true;
  }
}

function gradeRecommendation(requiredGpa) {
  if (requiredGpa <= 0) return 'Goal already protected';
  const grade = Object.entries(GRADE_SCALES[scaleSelect.value])
    .sort((left, right) => left[1] - right[1])
    .find(([, points]) => points >= requiredGpa - 1e-9);
  return grade ? `${grade[0]} or better` : 'Maximum grade required';
}

function updateGoalProjection(summary) {
  const count = Number(goalPlan.semestersRemaining);
  const target = Number(goalPlan.targetCgpa);
  const credits = goalPlan.futureCredits.map(Number);
  const ready = Number.isInteger(count) && count >= 1 && count <= 16
    && goalPlan.targetCgpa !== '' && target >= 0 && target <= Number(scaleSelect.value)
    && credits.length === count && credits.every((value, index) => goalPlan.futureCredits[index] !== '' && Number.isFinite(value) && value > 0);

  if (!ready) {
    goalProjection.hidden = true;
    return;
  }

  goalProjection.hidden = false;
  futureResultList.replaceChildren();
  if (summary.totalGpaCredits <= 0) {
    goalProjection.className = 'goal-projection projection-waiting';
    goalResultIcon.textContent = '…';
    goalResultTitle.textContent = 'Add your academic results first.';
    goalResultCopy.textContent = 'The planner needs at least one completed semester or graded course before it can project your CGPA.';
    return;
  }

  const futureTotal = credits.reduce((sum, value) => sum + value, 0);
  const required = (target * (summary.totalGpaCredits + futureTotal) - summary.totalQualityPoints) / futureTotal;
  const maximum = Number(scaleSelect.value);
  const maximumCgpa = (summary.totalQualityPoints + maximum * futureTotal) / (summary.totalGpaCredits + futureTotal);
  const possible = required <= maximum + 1e-9;
  const requiredDisplay = Math.max(0, required);

  goalProjection.className = `goal-projection ${possible ? 'projection-possible' : 'projection-impossible'}`;
  goalResultIcon.textContent = possible ? '✓' : '!';
  if (possible) {
    goalResultTitle.textContent = 'Yes—your CGPA goal is possible.';
    goalResultCopy.textContent = required <= 0
      ? `Your current results are strong enough to keep at least ${target.toFixed(2)} even with a 0.00 future average across the planned credits.`
      : `You need a weighted average GPA of at least ${requiredDisplay.toFixed(2)} across ${formatCredits(futureTotal)} future credits.`;
  } else {
    goalResultTitle.textContent = 'This goal is not possible with the current plan.';
    goalResultCopy.textContent = `Even with ${maximum.toFixed(2)} in every planned future credit, the highest projected CGPA is ${maximumCgpa.toFixed(2)}. Consider a lower goal or more future credits.`;
  }

  const requirement = Number(totalCreditsRequired);
  const graduationCreditsLeft = totalCreditsRequired === '' ? 0 : Math.max(0, requirement - summary.totalEarnedCredits);
  if (graduationCreditsLeft > futureTotal) {
    goalResultCopy.textContent += ` Your future plan includes ${formatCredits(futureTotal)} credits, but you still need ${formatCredits(graduationCreditsLeft)} credits to meet the graduation requirement.`;
  }

  credits.forEach((credit, index) => {
    const result = document.createElement('article');
    const term = document.createElement('strong');
    term.textContent = `Future semester ${index + 1}`;
    const creditText = document.createElement('span');
    creditText.textContent = `${formatCredits(credit)} credits`;
    const targetText = document.createElement('span');
    targetText.textContent = possible
      ? `${requiredDisplay.toFixed(2)} GPA · ${gradeRecommendation(requiredDisplay)}`
      : `${maximum.toFixed(2)} GPA maximum`;
    result.append(term, creditText, targetText);
    futureResultList.append(result);
  });
}

function buildGoalPlanForSave() {
  if (goalPlan.semestersRemaining === '' && goalPlan.targetCgpa === '') return null;
  const semestersRemaining = Number(goalPlan.semestersRemaining);
  const targetCgpa = Number(goalPlan.targetCgpa);
  const futureCredits = goalPlan.futureCredits.map(Number);
  if (!Number.isInteger(semestersRemaining) || semestersRemaining < 1 || semestersRemaining > 16) {
    throw new Error('Enter 1–16 semesters remaining.');
  }
  if (goalPlan.targetCgpa === '' || !Number.isFinite(targetCgpa) || targetCgpa < 0 || targetCgpa > Number(scaleSelect.value)) {
    throw new Error(`Target CGPA must be between 0 and ${scaleSelect.value}.`);
  }
  if (futureCredits.length !== semestersRemaining || futureCredits.some((value, index) => goalPlan.futureCredits[index] === '' || !Number.isFinite(value) || value <= 0)) {
    throw new Error('Enter planned credits for every future semester.');
  }
  return { semestersRemaining, targetCgpa, futureCredits };
}

function openWorkspace(profile) {
  courses = profile.courses.map((course) => ({ ...course }));
  previousTerms = (profile.previousTerms || []).map((term) => ({ ...term }));
  totalCreditsRequired = profile.totalCreditsRequired === null || profile.totalCreditsRequired === undefined
    ? ''
    : String(profile.totalCreditsRequired);
  goalPlan = profile.goalPlan
    ? { semestersRemaining: String(profile.goalPlan.semestersRemaining), targetCgpa: String(profile.goalPlan.targetCgpa), futureCredits: profile.goalPlan.futureCredits.map(String) }
    : { semestersRemaining: '', targetCgpa: '', futureCredits: [] };
  ensureTrailingPreviousTerm();
  isNewRecord = profile.isNew;
  maskedId.textContent = profile.studentId;
  scaleSelect.value = profile.scale;
  newRecordNote.hidden = !profile.isNew;
  accessPanel.hidden = true;
  workspace.hidden = false;
  totalCreditsRequiredInput.value = totalCreditsRequired;
  renderGoalPlanner();
  renderPreviousTerms();
  renderCourses();
  saveStatus.textContent = profile.updatedAt
    ? `Last saved ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(profile.updatedAt))}`
    : 'Not saved yet.';
  saveStatus.className = '';
  if (courses.length === 0) addCourse();
}

function lockWorkspace() {
  credentials = null;
  courses = [];
  previousTerms = [];
  totalCreditsRequired = '';
  goalPlan = { semestersRemaining: '', targetCgpa: '', futureCredits: [] };
  isNewRecord = false;
  workspace.hidden = true;
  accessPanel.hidden = false;
  studentIdInput.value = '';
  pinInput.value = '';
  accessError.textContent = '';
  studentIdInput.focus();
}

accessForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  accessError.textContent = '';
  const studentId = studentIdInput.value.trim();
  const pin = pinInput.value.trim();
  const submit = accessForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'Opening…';
  try {
    const profile = await postJson('/api/grades/load', { studentId, pin });
    credentials = { studentId, pin };
    openWorkspace(profile);
  } catch (error) {
    accessError.textContent = error.message;
  } finally {
    submit.disabled = false;
    submit.innerHTML = 'Open calculator <span aria-hidden="true">→</span>';
  }
});

scaleSelect.addEventListener('change', () => {
  const allowed = new Set([...Object.keys(GRADE_SCALES[scaleSelect.value]), 'P', 'NP']);
  courses.forEach((course) => { if (!allowed.has(course.grade)) course.grade = ''; });
  renderGoalPlanner();
  renderPreviousTerms();
  renderCourses();
  markUnsaved();
});

addCourseButton.addEventListener('click', addCourse);
lockButton.addEventListener('click', lockWorkspace);

totalCreditsRequiredInput.addEventListener('input', () => {
  totalCreditsRequired = totalCreditsRequiredInput.value;
  calculateSummary();
  scheduleAcademicProgressSave();
});

semestersRemainingInput.addEventListener('input', () => {
  goalPlan.semestersRemaining = semestersRemainingInput.value;
  renderGoalPlanner();
  calculateSummary();
  markUnsaved();
});

targetCgpaInput.addEventListener('input', () => {
  goalPlan.targetCgpa = targetCgpaInput.value;
  calculateSummary();
  markUnsaved();
});

saveButton.addEventListener('click', async () => {
  saveError.textContent = '';
  const completeCourses = courses.filter((course) => course.name.trim() || course.grade);
  const incompleteTermIndex = previousTerms.findIndex((term) => hasPreviousTermInput(term) && !isPreviousTermComplete(term));
  if (incompleteTermIndex !== -1) {
    saveError.textContent = `Complete all results for Semester ${incompleteTermIndex + 1} before saving.`;
    return;
  }
  const completePreviousTerms = previousTerms.filter(isPreviousTermComplete);
  let goalPlanForSave;
  try {
    goalPlanForSave = buildGoalPlanForSave();
  } catch (error) {
    saveError.textContent = error.message;
    return;
  }
  saveButton.disabled = true;
  saveButton.textContent = 'Saving…';
  try {
    const profile = await postJson('/api/grades/save', {
      ...credentials,
      scale: scaleSelect.value,
      previousTerms: completePreviousTerms,
      totalCreditsRequired: totalCreditsRequired === '' ? null : Number(totalCreditsRequired),
      goalPlan: goalPlanForSave,
      courses: completeCourses
    });
    courses = profile.courses.map((course) => ({ ...course }));
    previousTerms = profile.previousTerms.map((term) => ({ ...term }));
    totalCreditsRequired = profile.totalCreditsRequired === null || profile.totalCreditsRequired === undefined
      ? ''
      : String(profile.totalCreditsRequired);
    goalPlan = profile.goalPlan
      ? { semestersRemaining: String(profile.goalPlan.semestersRemaining), targetCgpa: String(profile.goalPlan.targetCgpa), futureCredits: profile.goalPlan.futureCredits.map(String) }
      : { semestersRemaining: '', targetCgpa: '', futureCredits: [] };
    ensureTrailingPreviousTerm();
    isNewRecord = false;
    newRecordNote.hidden = true;
    totalCreditsRequiredInput.value = totalCreditsRequired;
    renderGoalPlanner();
    renderPreviousTerms();
    renderCourses();
    saveStatus.textContent = `Saved ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(profile.updatedAt))}`;
    saveStatus.className = 'is-saved';
  } catch (error) {
    saveError.textContent = error.message;
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = 'Save grade record';
  }
});
