'use strict';

// Stores anonymous Sudoku gameplay events and turns them into analytics that
// help decide which game to build next. No student IDs, names or IP addresses
// are saved — only a random player ID generated in the player's browser.

const fs = require('node:fs');
const path = require('node:path');
const PUZZLES = require('./sudokuPuzzles.json');

const MAX_EVENTS = 200000;
const EVENT_TYPES = new Set(['session_start', 'level_start', 'level_resume', 'level_complete', 'level_abandon', 'level_restart', 'level_rating', 'next_game_vote']);
const NEXT_GAME_OPTIONS = ['minesweeper', '2048', 'kakuro', 'killer-sudoku', 'nonogram', 'word-puzzle', 'chess-puzzles', 'memory-match', 'other'];
const RATINGS = ['too-easy', 'just-right', 'too-hard'];
const ID_PATTERN = /^[a-z0-9-]{8,64}$/i;

function int(value, min, max) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, n));
}

function pick(value, allowed) {
  return allowed.includes(value) ? value : undefined;
}

function cleanText(value, max) {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
  return text || undefined;
}

function median(values) {
  if (!values.length) return null;
  const s = values.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function average(values) {
  if (!values.length) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}

class SudokuStore {
  constructor(file) {
    this.file = file;
    this.data = this.read();
  }

  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(parsed.events)) return parsed;
    } catch { /* first run */ }
    return { version: 1, events: [] };
  }

  write() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  // Validates one raw event from the browser. Returns a clean event or null.
  normalizeEvent(raw, playerId, sessionId, receivedAt) {
    if (!raw || typeof raw !== 'object' || !EVENT_TYPES.has(raw.type)) return null;
    const event = { type: raw.type, playerId, sessionId, at: receivedAt };
    const clientAt = Date.parse(raw.at);
    if (Number.isFinite(clientAt) && Math.abs(clientAt - Date.parse(receivedAt)) < 7 * 864e5) event.clientAt = new Date(clientAt).toISOString();

    if (raw.type === 'session_start') {
      event.device = pick(raw.device, ['phone', 'tablet', 'desktop']);
      event.input = pick(raw.input, ['touch', 'mouse']);
      event.lang = cleanText(raw.lang, 12);
      event.hour = int(raw.hour, 0, 23);
      event.returning = raw.returning === true;
      return event;
    }

    if (raw.type === 'next_game_vote') {
      event.choice = pick(raw.choice, NEXT_GAME_OPTIONS);
      if (!event.choice) return null;
      event.note = cleanText(raw.note, 140);
      event.levelsCompleted = int(raw.levelsCompleted, 0, 50);
      return event;
    }

    const level = Number(raw.level);
    if (!Number.isInteger(level) || level < 1 || level > PUZZLES.length) return null;
    event.level = level;
    event.tier = PUZZLES[level - 1].tier;

    if (raw.type === 'level_rating') {
      event.rating = pick(raw.rating, RATINGS);
      return event.rating ? event : null;
    }

    event.activeMs = int(raw.activeMs, 0, 24 * 3600 * 1000);
    event.mistakes = int(raw.mistakes, 0, 10000);
    event.hints = int(raw.hints, 0, 81);
    event.undos = int(raw.undos, 0, 100000);
    event.notes = int(raw.notes, 0, 100000);
    event.filled = int(raw.filled, 0, 81);
    event.attempt = int(raw.attempt, 1, 1000);

    if (raw.type === 'level_complete') {
      // Only accept completions whose final grid really is the solution.
      event.verified = typeof raw.grid === 'string' && raw.grid === PUZZLES[level - 1].solution;
      event.keyboardShare = int(raw.keyboardShare, 0, 100);
    }
    return event;
  }

  addEvents(body) {
    const playerId = typeof body?.playerId === 'string' && ID_PATTERN.test(body.playerId) ? body.playerId : null;
    const sessionId = typeof body?.sessionId === 'string' && ID_PATTERN.test(body.sessionId) ? body.sessionId : null;
    if (!playerId || !sessionId) throw Object.assign(new Error('Invalid player.'), { status: 400 });
    if (!Array.isArray(body.events) || body.events.length === 0 || body.events.length > 50) {
      throw Object.assign(new Error('Send between 1 and 50 events.'), { status: 400 });
    }
    const receivedAt = new Date().toISOString();
    const clean = body.events.map((e) => this.normalizeEvent(e, playerId, sessionId, receivedAt)).filter(Boolean);
    if (clean.length) {
      this.data.events.push(...clean);
      if (this.data.events.length > MAX_EVENTS) this.data.events.splice(0, this.data.events.length - MAX_EVENTS);
      this.data.updatedAt = receivedAt;
      this.write();
    }
    return { accepted: clean.length };
  }

  puzzlesForClient() {
    return PUZZLES.map(({ id, tier, puzzle, solution }) => ({ id, tier, puzzle, solution }));
  }

  summary() {
    const events = this.data.events;
    const players = new Set();
    const levels = PUZZLES.map((p) => ({
      level: p.id, tier: p.tier, clues: p.clues,
      starters: new Set(), finishers: new Set(), abandons: 0, restarts: 0,
      times: [], mistakes: [], hints: [], ratings: { 'too-easy': 0, 'just-right': 0, 'too-hard': 0 }, unverified: 0
    }));
    const devices = {};
    const hours = Array(24).fill(0);
    const votes = {};
    const voteNotes = [];
    const playerVote = new Map();
    const playerDays = new Map();
    const playerMax = new Map();

    for (const e of events) {
      players.add(e.playerId);
      const day = e.at.slice(0, 10);
      if (!playerDays.has(e.playerId)) playerDays.set(e.playerId, new Set());
      playerDays.get(e.playerId).add(day);

      if (e.type === 'session_start') {
        if (e.device) devices[e.device] = (devices[e.device] || 0) + 1;
        if (Number.isInteger(e.hour)) hours[e.hour] += 1;
        continue;
      }
      if (e.type === 'next_game_vote') {
        playerVote.set(e.playerId, e.choice); // latest vote per player wins
        if (e.note) voteNotes.push({ choice: e.choice, note: e.note, at: e.at });
        continue;
      }
      const L = levels[e.level - 1];
      if (!L) continue;
      if (e.type === 'level_start') L.starters.add(e.playerId);
      if (e.type === 'level_abandon') L.abandons += 1;
      if (e.type === 'level_restart') L.restarts += 1;
      if (e.type === 'level_rating') L.ratings[e.rating] += 1;
      if (e.type === 'level_complete') {
        if (!e.verified) { L.unverified += 1; continue; }
        L.finishers.add(e.playerId);
        L.starters.add(e.playerId);
        if (e.activeMs) L.times.push(e.activeMs);
        L.mistakes.push(e.mistakes || 0);
        L.hints.push(e.hints || 0);
        playerMax.set(e.playerId, Math.max(playerMax.get(e.playerId) || 0, e.level));
      }
    }
    for (const choice of playerVote.values()) votes[choice] = (votes[choice] || 0) + 1;

    const levelRows = levels.map((L) => ({
      level: L.level, tier: L.tier, clues: L.clues,
      players: L.starters.size,
      completed: L.finishers.size,
      completionRate: L.starters.size ? Math.round((L.finishers.size / L.starters.size) * 100) : null,
      medianSeconds: L.times.length ? Math.round(median(L.times) / 1000) : null,
      avgMistakes: average(L.mistakes),
      avgHints: average(L.hints),
      abandons: L.abandons,
      restarts: L.restarts,
      ratings: L.ratings,
      unverified: L.unverified
    }));

    const tiers = [1, 2, 3, 4, 5].map((tier) => {
      const rows = levelRows.filter((r) => r.tier === tier);
      const tierPlayers = new Set();
      const tierFinishers = new Set();
      levels.filter((L) => L.tier === tier).forEach((L) => { L.starters.forEach((p) => tierPlayers.add(p)); L.finishers.forEach((p) => tierFinishers.add(p)); });
      return {
        tier,
        players: tierPlayers.size,
        finishedAtLeastOne: tierFinishers.size,
        completions: rows.reduce((a, r) => a + r.completed, 0),
        medianSeconds: median(rows.map((r) => r.medianSeconds).filter((v) => v !== null))
      };
    });

    const returning = [...playerDays.values()].filter((d) => d.size > 1).length;
    return {
      updatedAt: this.data.updatedAt || null,
      totals: {
        players: players.size,
        returningPlayers: returning,
        returnRate: players.size ? Math.round((returning / players.size) * 100) : null,
        events: events.length,
        verifiedCompletions: levelRows.reduce((a, r) => a + r.completed, 0),
        avgFurthestLevel: average([...playerMax.values()])
      },
      devices,
      playHours: hours,
      nextGameVotes: Object.entries(votes).sort((a, b) => b[1] - a[1]).map(([choice, count]) => ({ choice, count })),
      voteNotes: voteNotes.slice(-50).reverse(),
      tiers,
      levels: levelRows
    };
  }

  toCsv() {
    const cols = ['at', 'clientAt', 'type', 'playerId', 'sessionId', 'level', 'tier', 'attempt', 'activeMs', 'mistakes', 'hints', 'undos', 'notes', 'filled', 'verified', 'keyboardShare', 'rating', 'choice', 'note', 'device', 'input', 'lang', 'hour', 'returning'];
    const esc = (v) => {
      if (v === undefined || v === null) return '';
      const s = String(v);
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // block spreadsheet formula injection
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    return [cols.join(','), ...this.data.events.map((e) => cols.map((c) => esc(e[c])).join(','))].join('\n');
  }
}

module.exports = { SudokuStore, NEXT_GAME_OPTIONS };
