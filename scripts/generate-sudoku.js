'use strict';
// Generates 50 Sudoku puzzles (5 tiers x 10) with verified unique solutions,
// graded by which human solving techniques they require.
const fs = require('node:fs');

let seed = 20261012;
function rand() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

const ROW = (i) => Math.floor(i / 9), COL = (i) => i % 9, BOX = (i) => Math.floor(ROW(i) / 3) * 3 + Math.floor(COL(i) / 3);
const UNITS = [];
for (let r = 0; r < 9; r++) UNITS.push([...Array(9)].map((_, c) => r * 9 + c));
for (let c = 0; c < 9; c++) UNITS.push([...Array(9)].map((_, r) => r * 9 + c));
for (let b = 0; b < 9; b++) { const u = []; for (let i = 0; i < 81; i++) if (BOX(i) === b) u.push(i); UNITS.push(u); }
const PEERS = [...Array(81)].map((_, i) => { const s = new Set(); for (const u of UNITS) if (u.includes(i)) u.forEach((j) => j !== i && s.add(j)); return [...s]; });

function canPlace(g, i, v) { return PEERS[i].every((j) => g[j] !== v); }

function countSolutions(g, limit = 2) {
  let best = -1, bestOpts = null;
  for (let i = 0; i < 81; i++) {
    if (g[i]) continue;
    const opts = [];
    for (let v = 1; v <= 9; v++) if (canPlace(g, i, v)) opts.push(v);
    if (!opts.length) return 0;
    if (!bestOpts || opts.length < bestOpts.length) { best = i; bestOpts = opts; if (opts.length === 1) break; }
  }
  if (best < 0) return 1;
  let n = 0;
  for (const v of bestOpts) { g[best] = v; n += countSolutions(g, limit - n); g[best] = 0; if (n >= limit) break; }
  return n;
}

function fullGrid() {
  const g = Array(81).fill(0);
  (function fill(i) {
    if (i === 81) return true;
    for (const v of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9])) if (canPlace(g, i, v)) { g[i] = v; if (fill(i + 1)) return true; g[i] = 0; }
    return false;
  })(0);
  return g;
}

// Logical solver. Returns hardest technique level needed (1 singles, 2 locked candidates,
// 3 naked/hidden pairs+triples, 9 = beyond these) and number of steps.
function grade(puzzle) {
  const g = puzzle.slice();
  const cand = g.map((v, i) => (v ? new Set() : new Set([1, 2, 3, 4, 5, 6, 7, 8, 9].filter((x) => canPlace(g, i, x)))));
  const place = (i, v) => { g[i] = v; cand[i].clear(); PEERS[i].forEach((j) => cand[j].delete(v)); };
  let level = 0, steps = 0;
  const done = () => g.every((v) => v);
  while (!done()) {
    steps++;
    let progress = false;
    // naked single
    for (let i = 0; i < 81 && !progress; i++) if (!g[i] && cand[i].size === 1) { place(i, [...cand[i]][0]); progress = true; }
    // hidden single
    if (!progress) for (const u of UNITS) {
      for (let v = 1; v <= 9 && !progress; v++) {
        const spots = u.filter((i) => cand[i].has(v));
        if (spots.length === 1) { place(spots[0], v); progress = true; }
      }
      if (progress) break;
    }
    if (progress) { level = Math.max(level, 1); continue; }
    // locked candidates (pointing / claiming)
    for (const u of UNITS) {
      for (let v = 1; v <= 9 && !progress; v++) {
        const spots = u.filter((i) => cand[i].has(v));
        if (spots.length < 2) continue;
        for (const other of UNITS) {
          if (other === u || !spots.every((i) => other.includes(i))) continue;
          for (const j of other) if (!spots.includes(j) && cand[j].has(v)) { cand[j].delete(v); progress = true; }
        }
      }
      if (progress) break;
    }
    if (progress) { level = Math.max(level, 2); continue; }
    // naked pairs/triples and hidden pairs
    for (const u of UNITS) {
      const empty = u.filter((i) => !g[i]);
      for (const size of [2, 3]) {
        const combos = (arr, k, start = 0, cur = [], out = []) => { if (cur.length === k) { out.push(cur.slice()); return out; } for (let x = start; x < arr.length; x++) { cur.push(arr[x]); combos(arr, k, x + 1, cur, out); cur.pop(); } return out; };
        for (const set of combos(empty, size)) {
          const union = new Set(); set.forEach((i) => cand[i].forEach((v) => union.add(v)));
          if (union.size !== size) continue;
          for (const j of empty) if (!set.includes(j)) for (const v of union) if (cand[j].delete(v)) progress = true;
        }
        for (const digits of combos([1, 2, 3, 4, 5, 6, 7, 8, 9], size)) {
          const cells = new Set(); let ok = true;
          for (const v of digits) { const sp = empty.filter((i) => cand[i].has(v)); if (!sp.length) { ok = false; break; } sp.forEach((i) => cells.add(i)); }
          if (!ok || cells.size !== size) continue;
          for (const i of cells) for (const v of [...cand[i]]) if (!digits.includes(v)) { cand[i].delete(v); progress = true; }
        }
        if (progress) break;
      }
      if (progress) break;
    }
    if (progress) { level = Math.max(level, 3); continue; }
    return { level: 9, steps };
  }
  return { level, steps };
}

function makePuzzle(minClues) {
  const solution = fullGrid();
  const p = solution.slice();
  let clues = 81;
  // remove symmetric pairs while unique
  for (const i of shuffle([...Array(41).keys()])) {
    if (clues <= minClues) break;
    const j = 80 - i;
    const a = p[i], b = p[j];
    p[i] = 0; p[j] = 0;
    if (countSolutions(p.slice()) !== 1) { p[i] = a; p[j] = b; } else clues -= i === j ? 1 : 2;
  }
  return { puzzle: p, solution, clues };
}

const tiers = [
  { level: [1], hi: 45, lo: 38 },
  { level: [1], hi: 36, lo: 31 },
  { level: [2], hi: 31, lo: 27 },
  { level: [3], hi: 29, lo: 25 },
  { level: [9], hi: 26, lo: 22 }
];

const out = [];
const seen = new Set();
tiers.forEach((t, ti) => {
  const picked = [];
  let tries = 0;
  while (picked.length < 10) {
    tries++;
    const target = Math.round(t.hi - (t.hi - t.lo) * picked.length / 9);
    const { puzzle, solution, clues } = makePuzzle(target);
    const key = puzzle.join('');
    if (seen.has(key)) continue;
    const gr = grade(puzzle);
    if (!t.level.includes(gr.level) || clues > target + 1) continue;
    seen.add(key);
    picked.push({ puzzle, solution, clues, technique: gr.level, steps: gr.steps });
  }
  // easier first within a tier: more clues, fewer steps
  picked.sort((a, b) => b.clues - a.clues || a.steps - b.steps);
  console.error(`tier ${ti + 1}: ${tries} tries, clues ${picked.map((p) => p.clues).join(',')}`);
  picked.forEach((p) => out.push({ tier: ti + 1, ...p }));
});

// final verification
for (const p of out) {
  if (countSolutions(p.puzzle.slice(), 3) !== 1) throw new Error('not unique');
  p.puzzle.forEach((v, i) => { if (v && v !== p.solution[i]) throw new Error('mismatch'); });
}

const data = out.map((p, i) => ({ id: i + 1, tier: p.tier, clues: p.clues, technique: p.technique, puzzle: p.puzzle.join(''), solution: p.solution.join('') }));
fs.writeFileSync(process.argv[2], JSON.stringify(data));
console.error('wrote', data.length);
