'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SudokuStore } = require('../src/sudokuStore');
const PUZZLES = require('../src/sudokuPuzzles.json');

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sudoku-'));
  return new SudokuStore(path.join(dir, 'sudoku.json'));
}

function solutions(grid, limit = 2) {
  const g = [...grid].map(Number);
  const ok = (i, v) => {
    const r = Math.floor(i / 9), c = i % 9, br = r - (r % 3), bc = c - (c % 3);
    for (let k = 0; k < 9; k++) {
      if (g[r * 9 + k] === v || g[k * 9 + c] === v || g[(br + Math.floor(k / 3)) * 9 + bc + (k % 3)] === v) return false;
    }
    return true;
  };
  let count = 0;
  (function solve() {
    const i = g.indexOf(0);
    if (i < 0) { count++; return; }
    for (let v = 1; v <= 9 && count < limit; v++) if (ok(i, v)) { g[i] = v; solve(); g[i] = 0; }
  })();
  return count;
}

test('there are 50 puzzles, 10 per tier, each with exactly one solution', () => {
  assert.equal(PUZZLES.length, 50);
  for (let tier = 1; tier <= 5; tier++) assert.equal(PUZZLES.filter((p) => p.tier === tier).length, 10);
  for (const p of PUZZLES) {
    assert.match(p.puzzle, /^[0-9]{81}$/);
    assert.match(p.solution, /^[1-9]{81}$/);
    [...p.puzzle].forEach((ch, i) => { if (ch !== '0') assert.equal(ch, p.solution[i]); });
    assert.equal(solutions(p.puzzle), 1, `level ${p.id} must have a unique solution`);
  }
  assert.equal(new Set(PUZZLES.map((p) => p.puzzle)).size, 50);
});

test('tiers get harder: average clue count falls tier by tier', () => {
  const avg = (t) => PUZZLES.filter((p) => p.tier === t).reduce((a, p) => a + p.clues, 0) / 10;
  for (let t = 1; t < 5; t++) assert.ok(avg(t) > avg(t + 1), `tier ${t} should have more clues than tier ${t + 1}`);
});

test('events are validated and only real solutions count as completions', () => {
  const store = tmpStore();
  const base = { playerId: 'player-aaaaaaaa', sessionId: 'session-bbbbbbbb' };
  const r = store.addEvents({
    ...base,
    events: [
      { type: 'session_start', device: 'phone', hour: 21 },
      { type: 'level_start', level: 1 },
      { type: 'level_complete', level: 1, activeMs: 90000, mistakes: 2, hints: 1, grid: PUZZLES[0].solution },
      { type: 'level_complete', level: 2, activeMs: 1000, grid: '1'.repeat(81) },
      { type: 'level_rating', level: 1, rating: 'just-right' },
      { type: 'next_game_vote', choice: 'minesweeper', note: 'with a daily mode' },
      { type: 'hack', level: 1 },
      { type: 'level_start', level: 99 }
    ]
  });
  assert.equal(r.accepted, 6);
  const s = store.summary();
  assert.equal(s.totals.players, 1);
  assert.equal(s.levels[0].completed, 1);
  assert.equal(s.levels[0].medianSeconds, 90);
  assert.equal(s.levels[1].completed, 0);
  assert.equal(s.levels[1].unverified, 1);
  assert.deepEqual(s.nextGameVotes, [{ choice: 'minesweeper', count: 1 }]);
  assert.equal(s.devices.phone, 1);
});

test('bad player IDs and oversized batches are rejected', () => {
  const store = tmpStore();
  assert.throws(() => store.addEvents({ playerId: 'x', sessionId: 'session-bbbbbbbb', events: [{ type: 'level_start', level: 1 }] }));
  assert.throws(() => store.addEvents({ playerId: 'player-aaaaaaaa', sessionId: 'session-bbbbbbbb', events: Array(51).fill({ type: 'level_start', level: 1 }) }));
});

test('CSV export neutralises spreadsheet formulas', () => {
  const store = tmpStore();
  store.addEvents({ playerId: 'player-aaaaaaaa', sessionId: 'session-bbbbbbbb', events: [{ type: 'next_game_vote', choice: 'other', note: '=HYPERLINK("x")' }] });
  const csv = store.toCsv();
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(!/,=HYPERLINK/.test(csv));
});
