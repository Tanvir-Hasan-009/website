'use strict';

(() => {
  // ---------- storage helpers (storage can be blocked; never let it break the game) ----------
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
    }
  };

  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
  const $ = (sel) => document.querySelector(sel);

  // ---------- anonymous analytics ----------
  const existingPlayer = store.get('sudoku.player', null);
  const playerId = existingPlayer || uid();
  if (!existingPlayer) store.set('sudoku.player', playerId);
  const sessionId = uid();
  let queue = store.get('sudoku.queue', []);
  let flushing = false;

  function track(type, data = {}) {
    queue.push({ type, at: new Date().toISOString(), ...data });
    if (queue.length > 300) queue = queue.slice(-300);
    store.set('sudoku.queue', queue);
    if (type === 'level_complete' || type === 'next_game_vote') flush();
  }

  async function flush(keepalive = false) {
    if (flushing || !queue.length) return;
    flushing = true;
    const batch = queue.slice(0, 50);
    try {
      const res = await fetch('/api/sudoku/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, sessionId, events: batch }),
        keepalive
      });
      if (res.ok || res.status === 400) {
        queue = queue.slice(batch.length);
        store.set('sudoku.queue', queue);
      }
    } catch { /* offline — keep queue for later */ }
    flushing = false;
  }
  setInterval(flush, 15000);

  const coarse = matchMedia('(pointer: coarse)').matches;
  const width = Math.min(screen.width, screen.height);
  track('session_start', {
    device: coarse ? (width < 600 ? 'phone' : 'tablet') : 'desktop',
    input: coarse ? 'touch' : 'mouse',
    lang: navigator.language,
    hour: new Date().getHours(),
    returning: Boolean(existingPlayer)
  });

  // ---------- progress ----------
  const progress = Object.assign({ completed: {}, saves: {}, attempts: {}, voted: false, voteSkips: 0 }, store.get('sudoku.progress', {}));
  const saveProgress = () => store.set('sudoku.progress', progress);

  let puzzles = [];
  const isDone = (id) => Boolean(progress.completed[id]);
  const isUnlocked = (p) => (p.id - 1) % 10 === 0 || isDone(p.id - 1);

  // ---------- level map ----------
  function renderMap() {
    const list = $('#tier-list');
    list.replaceChildren();
    for (let tier = 1; tier <= 5; tier++) {
      const tierPuzzles = puzzles.filter((p) => p.tier === tier);
      const done = tierPuzzles.filter((p) => isDone(p.id)).length;
      const card = document.createElement('article');
      card.className = 'tier-card';

      const head = document.createElement('div');
      head.className = 'tier-head';
      const label = document.createElement('p');
      label.className = 'step-label';
      label.textContent = `Levels ${tierPuzzles[0].id}–${tierPuzzles[tierPuzzles.length - 1].id}`;
      const h = document.createElement('h2');
      h.textContent = `Tier ${tier}`;
      const dots = document.createElement('div');
      dots.className = 'tier-dots';
      dots.setAttribute('aria-label', `Difficulty ${tier} of 5`);
      for (let d = 1; d <= 5; d++) { const i = document.createElement('i'); if (d <= tier) i.className = 'on'; dots.append(i); }
      const count = document.createElement('p');
      count.className = 'tier-count';
      count.textContent = `${done} of 10 solved`;
      head.append(label, h, dots, count);

      const row = document.createElement('div');
      row.className = 'level-row';
      let currentMarked = false;
      for (const p of tierPuzzles) {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'level-tile';
        tile.textContent = p.id;
        const unlocked = isUnlocked(p);
        if (isDone(p.id)) tile.classList.add('is-done');
        else if (unlocked && !currentMarked) { tile.classList.add('is-current'); currentMarked = true; }
        if (progress.saves[p.id] && !isDone(p.id)) tile.classList.add('is-saved');
        tile.disabled = !unlocked;
        tile.setAttribute('aria-label', `Level ${p.id}${isDone(p.id) ? ', solved' : unlocked ? '' : ', locked'}`);
        tile.addEventListener('click', () => openLevel(p.id));
        row.append(tile);
      }
      card.append(head, row);
      list.append(card);
    }
    const total = Object.keys(progress.completed).length;
    $('#total-done').textContent = total;
    $('#total-bar').style.width = `${(total / 50) * 100}%`;
  }

  // ---------- game state ----------
  let game = null;
  let selected = -1;
  let notesMode = false;
  let tickTimer = null;
  let lastTick = 0;
  const cells = [];
  const numButtons = [];

  const rowOf = (i) => Math.floor(i / 9);
  const colOf = (i) => i % 9;
  const boxOf = (i) => Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3);
  const peers = (i) => {
    const out = [];
    for (let j = 0; j < 81; j++) if (j !== i && (rowOf(j) === rowOf(i) || colOf(j) === colOf(i) || boxOf(j) === boxOf(i))) out.push(j);
    return out;
  };
  const PEERS = Array.from({ length: 81 }, (_, i) => peers(i));

  function buildBoard() {
    const board = $('#board');
    for (let i = 0; i < 81; i++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = `cell r${rowOf(i) + 1} c${colOf(i) + 1}`;
      cell.setAttribute('role', 'gridcell');
      cell.tabIndex = -1;
      cell.addEventListener('pointerdown', (e) => { e.preventDefault(); select(i); });
      cells.push(cell);
      board.append(cell);
    }
    board.tabIndex = 0;
    const pad = $('#numpad');
    for (let d = 1; d <= 9; d++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'num';
      b.innerHTML = `${d}<small></small>`;
      b.setAttribute('aria-label', `Enter ${d}`);
      b.addEventListener('click', () => input(d, 'pointer'));
      numButtons.push(b);
      pad.append(b);
    }
  }

  function openLevel(id) {
    const p = puzzles[id - 1];
    const saved = progress.saves[id];
    const attempt = (progress.attempts[id] || 0) + (saved ? 0 : 1);
    progress.attempts[id] = attempt;
    game = {
      id, tier: p.tier,
      given: [...p.puzzle].map((c) => c !== '0'),
      solution: [...p.solution].map(Number),
      values: saved ? saved.values.slice() : [...p.puzzle].map(Number),
      notes: saved ? saved.notes.slice() : Array(81).fill(0),
      hinted: saved ? (saved.hinted || []).slice() : [],
      mistakes: saved ? saved.mistakes : 0,
      hints: saved ? saved.hints : 0,
      undos: saved ? saved.undos || 0 : 0,
      noteCount: saved ? saved.noteCount || 0 : 0,
      activeMs: saved ? saved.activeMs : 0,
      keyInputs: 0, pointerInputs: 0,
      history: [],
      attempt,
      touched: Boolean(saved),
      finished: false
    };
    saveProgress();
    track(saved ? 'level_resume' : 'level_start', { level: id, attempt, filled: filledCount() });
    selected = game.values.findIndex((v) => v === 0);
    notesMode = false;
    $('#map-view').hidden = true;
    $('#game-view').hidden = false;
    $('#game-title').textContent = `Level ${id}`;
    $('#game-tier').textContent = `Tier ${p.tier}`;
    window.scrollTo({ top: 0 });
    render();
    startClock();
    $('#board').focus({ preventScroll: true });
  }

  function filledCount() {
    return game ? game.values.filter((v, i) => v && v === game.solution[i]).length : 0;
  }

  function persist() {
    if (!game || game.finished) return;
    progress.saves[game.id] = {
      values: game.values, notes: game.notes, hinted: game.hinted,
      mistakes: game.mistakes, hints: game.hints, undos: game.undos, noteCount: game.noteCount, activeMs: game.activeMs
    };
    saveProgress();
  }

  function leaveLevel(reason) {
    if (!game) return;
    stopClock();
    if (!game.finished) {
      persist();
      if (game.touched) {
        track('level_abandon', {
          level: game.id, attempt: game.attempt, activeMs: game.activeMs, mistakes: game.mistakes,
          hints: game.hints, undos: game.undos, notes: game.noteCount, filled: filledCount(), reason
        });
      }
    }
    flush(reason === 'pagehide');
  }

  function showMap() {
    leaveLevel('back');
    game = null;
    $('#game-view').hidden = true;
    $('#map-view').hidden = false;
    renderMap();
  }

  // ---------- clock: counts only while the page is visible ----------
  function startClock() {
    stopClock();
    lastTick = performance.now();
    tickTimer = setInterval(() => {
      const now = performance.now();
      if (game && !game.finished && document.visibilityState === 'visible') game.activeMs += Math.min(now - lastTick, 2000);
      lastTick = now;
      $('#stat-time').textContent = fmt(game ? game.activeMs : 0);
    }, 500);
  }
  function stopClock() { clearInterval(tickTimer); tickTimer = null; }
  const fmt = (ms) => { const s = Math.floor(ms / 1000); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`; };

  // ---------- input ----------
  function select(i) {
    selected = i;
    render();
  }

  function snapshot() {
    game.history.push({ values: game.values.slice(), notes: game.notes.slice() });
    if (game.history.length > 200) game.history.shift();
  }

  function input(d, via) {
    if (!game || game.finished || selected < 0 || game.given[selected]) return;
    const i = selected;
    if (game.values[i] && game.values[i] === game.solution[i]) return; // already solved cell
    if (notesMode && game.values[i]) return;
    via === 'key' ? game.keyInputs++ : game.pointerInputs++;
    game.touched = true;
    snapshot();
    if (notesMode) {
      game.notes[i] ^= 1 << d;
      game.noteCount++;
    } else {
      if (game.values[i] === d) { game.values[i] = 0; render(); persist(); return; }
      game.values[i] = d;
      game.notes[i] = 0;
      if (d !== game.solution[i]) {
        game.mistakes++;
      } else {
        for (const j of PEERS[i]) game.notes[j] &= ~(1 << d);
        cells[i].classList.remove('flash'); void cells[i].offsetWidth; cells[i].classList.add('flash');
      }
    }
    render();
    persist();
    checkSolved();
  }

  function erase() {
    if (!game || game.finished || selected < 0 || game.given[selected]) return;
    const i = selected;
    if (game.values[i] && game.values[i] === game.solution[i]) return;
    if (!game.values[i] && !game.notes[i]) return;
    snapshot();
    game.values[i] = 0;
    game.notes[i] = 0;
    render(); persist();
  }

  function undo() {
    if (!game || game.finished) return;
    const prev = game.history.pop();
    if (!prev) return;
    game.values = prev.values;
    game.notes = prev.notes;
    game.undos++;
    render(); persist();
  }

  function hint() {
    if (!game || game.finished) return;
    let i = selected;
    if (i < 0 || game.given[i] || game.values[i] === game.solution[i]) {
      const open = game.values.map((v, k) => (v === game.solution[k] ? -1 : k)).filter((k) => k >= 0);
      if (!open.length) return;
      i = open[Math.floor(Math.random() * open.length)];
    }
    snapshot();
    game.touched = true;
    game.values[i] = game.solution[i];
    game.notes[i] = 0;
    for (const j of PEERS[i]) game.notes[j] &= ~(1 << game.solution[i]);
    game.hinted.push(i);
    game.hints++;
    selected = i;
    render(); persist();
    checkSolved();
  }

  function restart() {
    if (!game || game.finished) return;
    if (game.touched && !window.confirm('Clear the board and start this puzzle again?')) return;
    track('level_restart', { level: game.id, attempt: game.attempt, activeMs: game.activeMs, mistakes: game.mistakes, hints: game.hints, filled: filledCount() });
    delete progress.saves[game.id];
    progress.attempts[game.id] = game.attempt; // openLevel adds one
    saveProgress();
    stopClock();
    const id = game.id;
    game = null;
    openLevel(id);
  }

  function toggleNotes() {
    notesMode = !notesMode;
    $('#tool-notes').setAttribute('aria-pressed', String(notesMode));
    $('#notes-state').textContent = notesMode ? 'on' : 'off';
  }

  function moveSelection(dr, dc) {
    if (selected < 0) { selected = 0; render(); return; }
    const r = (rowOf(selected) + dr + 9) % 9;
    const c = (colOf(selected) + dc + 9) % 9;
    select(r * 9 + c);
  }

  document.addEventListener('keydown', (e) => {
    if (!game || $('#game-view').hidden || !$('#done-dialog').hidden || !$('#vote-dialog').hidden) return;
    if (e.target instanceof HTMLInputElement) return;
    const k = e.key;
    if (/^[1-9]$/.test(k)) { input(Number(k), 'key'); e.preventDefault(); }
    else if (k === 'Backspace' || k === 'Delete' || k === '0') { erase(); e.preventDefault(); }
    else if (k === 'ArrowUp') { moveSelection(-1, 0); e.preventDefault(); }
    else if (k === 'ArrowDown') { moveSelection(1, 0); e.preventDefault(); }
    else if (k === 'ArrowLeft') { moveSelection(0, -1); e.preventDefault(); }
    else if (k === 'ArrowRight') { moveSelection(0, 1); e.preventDefault(); }
    else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') { undo(); e.preventDefault(); }
    else if (k.toLowerCase() === 'n') toggleNotes();
  });

  // ---------- rendering ----------
  function render() {
    if (!game) return;
    const sel = selected;
    const selVal = sel >= 0 ? game.values[sel] : 0;
    const counts = Array(10).fill(0);
    game.values.forEach((v, i) => { if (v && v === game.solution[i]) counts[v]++; });

    for (let i = 0; i < 81; i++) {
      const cell = cells[i];
      const v = game.values[i];
      const cls = ['cell', `r${rowOf(i) + 1}`, `c${colOf(i) + 1}`];
      if (game.given[i]) cls.push('given');
      if (v && !game.given[i] && v !== game.solution[i]) cls.push('wrong');
      if (game.hinted.includes(i)) cls.push('hinted');
      if (i === sel) cls.push('selected');
      else if (selVal && v === selVal) cls.push('same');
      else if (sel >= 0 && PEERS[sel].includes(i)) cls.push('peer');
      if (cell.classList.contains('flash')) cls.push('flash');
      cell.className = cls.join(' ');

      if (v) {
        cell.textContent = v;
      } else if (game.notes[i]) {
        const grid = document.createElement('span');
        grid.className = 'notes-grid';
        for (let d = 1; d <= 9; d++) {
          const s = document.createElement('span');
          if (game.notes[i] & (1 << d)) { s.textContent = d; if (d === selVal) s.className = 'hl'; }
          grid.append(s);
        }
        cell.replaceChildren(grid);
      } else {
        cell.textContent = '';
      }
      const where = `row ${rowOf(i) + 1}, column ${colOf(i) + 1}`;
      cell.setAttribute('aria-label', v ? `${where}: ${v}${game.given[i] ? ', given' : ''}` : `${where}: empty`);
    }

    numButtons.forEach((b, k) => {
      const d = k + 1;
      const left = 9 - counts[d];
      b.classList.toggle('used-up', left === 0);
      b.querySelector('small').textContent = left ? left : '';
    });
    $('#stat-mistakes').textContent = game.mistakes;
    $('#stat-hints').textContent = game.hints;
    $('#stat-time').textContent = fmt(game.activeMs);
  }

  // ---------- completion ----------
  function checkSolved() {
    if (!game.values.every((v, i) => v === game.solution[i])) return;
    game.finished = true;
    stopClock();
    const total = game.keyInputs + game.pointerInputs;
    const result = { activeMs: Math.round(game.activeMs), mistakes: game.mistakes, hints: game.hints };
    const prevBest = progress.completed[game.id];
    progress.completed[game.id] = prevBest && prevBest.activeMs <= result.activeMs ? prevBest : result;
    delete progress.saves[game.id];
    saveProgress();
    track('level_complete', {
      level: game.id, attempt: game.attempt, ...result, undos: game.undos, notes: game.noteCount, filled: 81,
      keyboardShare: total ? Math.round((game.keyInputs / total) * 100) : 0,
      grid: game.values.join('')
    });
    setTimeout(() => showDone(result), 450);
  }

  let ratedLevel = null;
  function showDone(result) {
    ratedLevel = game.id;
    $('#done-title').textContent = `Level ${game.id} complete`;
    $('#done-time').textContent = fmt(result.activeMs);
    $('#done-mistakes').textContent = result.mistakes;
    $('#done-hints').textContent = result.hints;
    document.querySelectorAll('#rate-row button').forEach((b) => b.classList.remove('chosen'));
    const next = nextLevelAfter(game.id);
    $('#done-next').hidden = !next;
    $('#done-dialog').hidden = false;
    $('#done-next').focus();
  }

  function nextLevelAfter(id) {
    if (id >= 50) return null;
    return puzzles[id]; // id is 1-based, so puzzles[id] is the next level
  }

  $('#rate-row').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-rating]');
    if (!b || !ratedLevel) return;
    document.querySelectorAll('#rate-row button').forEach((x) => x.classList.toggle('chosen', x === b));
    track('level_rating', { level: ratedLevel, rating: b.dataset.rating });
  });

  function afterDone(goNext) {
    $('#done-dialog').hidden = true;
    const id = ratedLevel;
    const solved = Object.keys(progress.completed).length;
    const tierEnd = id % 10 === 0;
    const shouldAsk = !progress.voted && progress.voteSkips < 3 && (solved === 3 || tierEnd || (solved >= 3 && solved % 8 === 0));
    const proceed = () => {
      const next = nextLevelAfter(id);
      if (goNext && next) { game = null; openLevel(next.id); } else showMap();
    };
    if (shouldAsk) showVote(proceed); else proceed();
  }
  $('#done-next').addEventListener('click', () => afterDone(true));
  $('#done-map').addEventListener('click', () => afterDone(false));

  // ---------- next-game vote ----------
  const GAMES = [
    ['minesweeper', 'Minesweeper'], ['2048', '2048'], ['kakuro', 'Kakuro'], ['killer-sudoku', 'Killer Sudoku'],
    ['nonogram', 'Nonogram'], ['word-puzzle', 'Word puzzle'], ['chess-puzzles', 'Chess puzzles'], ['memory-match', 'Memory match']
  ];
  let voteChoice = null;
  let voteThen = null;
  function showVote(then) {
    voteThen = then;
    voteChoice = null;
    const box = $('#vote-options');
    box.replaceChildren();
    for (const [key, label] of [...GAMES].sort(() => Math.random() - 0.5).concat([['other', 'Something else']])) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.dataset.choice = key;
      b.addEventListener('click', () => {
        voteChoice = key;
        box.querySelectorAll('button').forEach((x) => x.classList.toggle('chosen', x === b));
        $('#vote-send').disabled = false;
      });
      box.append(b);
    }
    $('#vote-note').value = '';
    $('#vote-send').disabled = true;
    $('#vote-dialog').hidden = false;
  }
  function closeVote() {
    $('#vote-dialog').hidden = true;
    const then = voteThen; voteThen = null;
    if (then) then();
  }
  $('#vote-skip').addEventListener('click', () => { progress.voteSkips++; saveProgress(); closeVote(); });
  $('#vote-send').addEventListener('click', () => {
    if (!voteChoice) return;
    track('next_game_vote', { choice: voteChoice, note: $('#vote-note').value.trim() || undefined, levelsCompleted: Object.keys(progress.completed).length });
    progress.voted = true;
    saveProgress();
    closeVote();
  });

  // ---------- wiring ----------
  $('#back-to-map').addEventListener('click', showMap);
  $('#tool-undo').addEventListener('click', undo);
  $('#tool-erase').addEventListener('click', erase);
  $('#tool-notes').addEventListener('click', toggleNotes);
  $('#tool-hint').addEventListener('click', hint);
  $('#tool-restart').addEventListener('click', restart);
  window.addEventListener('pagehide', () => { if (game) leaveLevel('pagehide'); else flush(true); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { persist(); flush(true); } });

  buildBoard();
  fetch('/api/sudoku/puzzles')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('load failed'))))
    .then((data) => { puzzles = data.puzzles; renderMap(); flush(); })
    .catch(() => {
      $('#tier-list').textContent = 'The puzzles could not be loaded. Refresh the page to try again.';
    });
})();
