'use strict';

// Sudoku analytics for the admin dashboard. Relies on `api`, `password` and
// `showToast` defined in admin.js (loaded first).

(() => {
  const $ = (sel) => document.querySelector(sel);
  const GAME_LABELS = {
    minesweeper: 'Minesweeper', 2048: '2048', kakuro: 'Kakuro', 'killer-sudoku': 'Killer Sudoku', nonogram: 'Nonogram',
    'word-puzzle': 'Word puzzle', 'chess-puzzles': 'Chess puzzles', 'memory-match': 'Memory match', other: 'Something else'
  };
  const fmtTime = (s) => (s === null || s === undefined ? '—' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
  const dash = (v, suffix = '') => (v === null || v === undefined ? '—' : `${v}${suffix}`);

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function bar(label, value, max, detail) {
    const row = el('div', 'bar-row');
    const top = el('div', 'bar-top');
    top.append(el('span', '', label), el('strong', '', detail ?? String(value)));
    const track = el('div', 'bar-track');
    const fill = el('i');
    fill.style.width = `${max ? Math.max(2, (value / max) * 100) : 0}%`;
    track.append(fill);
    row.append(top, track);
    return row;
  }

  function render(data) {
    const t = data.totals;
    const totals = $('#sudoku-totals');
    totals.replaceChildren(...[
      [t.players, 'players'],
      [dash(t.returnRate, '%'), 'came back another day'],
      [t.verifiedCompletions, 'puzzles solved'],
      [dash(t.avgFurthestLevel), 'avg furthest level']
    ].map(([v, l]) => { const a = el('article'); a.append(el('strong', '', String(v)), el('span', '', l)); return a; }));

    const votes = $('#sudoku-votes');
    const maxVote = Math.max(0, ...data.nextGameVotes.map((v) => v.count));
    votes.replaceChildren(...(data.nextGameVotes.length
      ? data.nextGameVotes.map((v) => bar(GAME_LABELS[v.choice] || v.choice, v.count, maxVote))
      : [el('p', 'insight-empty', 'No votes yet. Players are asked after their 3rd solved puzzle and at the end of each tier.')]));

    const notes = $('#sudoku-notes');
    notes.replaceChildren(...data.voteNotes.slice(0, 8).map((n) => {
      const p = el('p');
      p.append(el('b', '', `${GAME_LABELS[n.choice] || n.choice}: `), document.createTextNode(n.note));
      return p;
    }));

    const tiers = $('#sudoku-tiers');
    const maxTier = Math.max(0, ...data.tiers.map((x) => x.players));
    tiers.replaceChildren(...data.tiers.map((x) => bar(
      `Tier ${x.tier}`, x.finishedAtLeastOne, maxTier,
      `${x.finishedAtLeastOne} / ${x.players} · median ${fmtTime(x.medianSeconds)}`
    )));

    const table = $('#sudoku-levels');
    const head = el('thead');
    const hr = el('tr');
    ['Level', 'Tier', 'Clues', 'Players', 'Solved', 'Rate', 'Median time', 'Mistakes', 'Hints', 'Quit', 'Easy / Right / Hard'].forEach((h) => hr.append(el('th', '', h)));
    head.append(hr);
    const body = el('tbody');
    for (const r of data.levels) {
      const tr = el('tr');
      if (r.completionRate !== null && r.players >= 5 && r.completionRate < 50) tr.className = 'is-warning';
      [r.level, r.tier, r.clues, r.players, r.completed, dash(r.completionRate, '%'), fmtTime(r.medianSeconds),
        dash(r.avgMistakes), dash(r.avgHints), r.abandons,
        `${r.ratings['too-easy']} / ${r.ratings['just-right']} / ${r.ratings['too-hard']}`].forEach((v) => tr.append(el('td', '', String(v))));
      body.append(tr);
    }
    table.replaceChildren(head, body);
  }

  async function load() {
    render(await api('/api/admin/sudoku'));
  }
  window.loadSudokuInsights = load;

  $('#sudoku-refresh').addEventListener('click', () => load().then(() => showToast('Sudoku data refreshed.')).catch((e) => showToast(e.message, 'error')));

  $('#sudoku-export').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/admin/sudoku.csv', { headers: { 'X-Admin-Password': password } });
      if (!res.ok) throw new Error('Export failed.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sudoku-events-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.append(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      showToast(e.message, 'error');
    }
  });
})();
