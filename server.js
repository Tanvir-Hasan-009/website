'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { parseSurveyCsv, normalizeStudentId } = require('./src/csv');
const { SurveyStore } = require('./src/store');
const { GradeStore } = require('./src/gradeStore');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'store.json');
const GRADE_DATA_FILE = process.env.GRADE_DATA_FILE || path.join(__dirname, 'data', 'grades.json');
const store = new SurveyStore(DATA_FILE);
const gradeStore = new GradeStore(GRADE_DATA_FILE);

const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/admin', ['admin.html', 'text/html; charset=utf-8']],
  ['/grades', ['grades.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/admin.js', ['admin.js', 'text/javascript; charset=utf-8']],
  ['/grades.js', ['grades.js', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']]
]);

const lookupAttempts = new Map();
const adminAttempts = new Map();
const gradeAttempts = new Map();

function securityHeaders(res) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cache-Control', 'no-store');
}

function sendJson(res, status, body) {
  securityHeaders(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function readJson(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > maxBytes) {
        reject(Object.assign(new Error('Request is too large.'), { status: 413 }));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(Object.assign(new Error('Invalid JSON request.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function clientKey(req) {
  return req.socket.remoteAddress || 'unknown';
}

function isRateLimited(bucket, key, limit, windowMs) {
  const now = Date.now();
  const entry = bucket.get(key);
  if (!entry || entry.resetAt <= now) {
    bucket.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}

function secureEqual(left, right) {
  const leftHash = crypto.createHash('sha256').update(String(left)).digest();
  const rightHash = crypto.createHash('sha256').update(String(right)).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

function isAdmin(req) {
  const supplied = req.headers['x-admin-password'] || '';
  return ADMIN_PASSWORD.length >= 10 && secureEqual(supplied, ADMIN_PASSWORD);
}

function requireAdmin(req, res) {
  const key = clientKey(req);
  if (isAdmin(req)) {
    adminAttempts.delete(key);
    return true;
  }
  if (isRateLimited(adminAttempts, key, 10, 10 * 60 * 1000)) {
    sendError(res, 429, 'Too many administrator attempts. Please wait and try again.');
  } else {
    sendError(res, 401, 'Incorrect administrator password.');
  }
  return false;
}

function serveStatic(pathname, res) {
  const entry = staticFiles.get(pathname);
  if (!entry) return false;
  const [file, contentType] = entry;
  securityHeaders(res);
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(path.join(__dirname, 'public', file)).pipe(res);
  return true;
}

async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');

  try {
    if (req.method === 'GET' && serveStatic(url.pathname, res)) return;

    if (req.method === 'POST' && url.pathname === '/api/status') {
      if (isRateLimited(lookupAttempts, clientKey(req), 40, 5 * 60 * 1000)) {
        sendError(res, 429, 'Too many checks. Please wait a few minutes and try again.');
        return;
      }
      const body = await readJson(req, 2048);
      const studentId = normalizeStudentId(body.studentId);
      if (!studentId) {
        sendError(res, 400, 'Enter a valid student ID (4–32 letters or numbers).');
        return;
      }
      const maskedId = `${'•'.repeat(Math.max(0, studentId.length - 4))}${studentId.slice(-4)}`;
      sendJson(res, 200, { studentId: maskedId, surveys: store.lookup(studentId) });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/grades/load') {
      if (isRateLimited(gradeAttempts, clientKey(req), 30, 5 * 60 * 1000)) {
        sendError(res, 429, 'Too many grade-record attempts. Please wait and try again.');
        return;
      }
      const body = await readJson(req, 4096);
      sendJson(res, 200, gradeStore.load(body.studentId, body.pin));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/grades/save') {
      if (isRateLimited(gradeAttempts, clientKey(req), 30, 5 * 60 * 1000)) {
        sendError(res, 429, 'Too many grade-record attempts. Please wait and try again.');
        return;
      }
      const body = await readJson(req, 128 * 1024);
      const saved = gradeStore.save(body.studentId, body.pin, body.scale, body.courses, body.previousTerms, body.goalPlan, body.totalCreditsRequired);
      sendJson(res, 200, saved);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/grades/progress') {
      if (isRateLimited(gradeAttempts, clientKey(req), 30, 5 * 60 * 1000)) {
        sendError(res, 429, 'Too many grade-record attempts. Please wait and try again.');
        return;
      }
      const body = await readJson(req, 64 * 1024);
      const saved = gradeStore.saveAcademicProgress(body.studentId, body.pin, body.scale, body.previousTerms, body.totalCreditsRequired);
      sendJson(res, 200, saved);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/summary') {
      if (!requireAdmin(req, res)) return;
      sendJson(res, 200, { datasets: store.summary() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/import') {
      if (!requireAdmin(req, res)) return;
      const body = await readJson(req, 6 * 1024 * 1024);
      if (typeof body.csvText !== 'string') {
        sendError(res, 400, 'Choose a CSV file to upload.');
        return;
      }
      const parsed = parseSurveyCsv(body.csvText);
      const dataset = store.replaceDataset(body.datasetKey, body.fileName, parsed);
      sendJson(res, 200, { dataset, stats: parsed.stats, detected: parsed.detected });
      return;
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/admin/datasets/')) {
      if (!requireAdmin(req, res)) return;
      const key = decodeURIComponent(url.pathname.slice('/api/admin/datasets/'.length));
      store.clearDataset(key);
      sendJson(res, 200, { datasets: store.summary() });
      return;
    }

    sendError(res, 404, 'Not found.');
  } catch (error) {
    const status = error.status || (error.message?.includes('Unknown survey') ? 400 : 400);
    sendError(res, status, error.message || 'Something went wrong.');
  }
}

function createServer() {
  return http.createServer(handleRequest);
}

if (require.main === module) {
  if (ADMIN_PASSWORD.length < 10) {
    console.error('ADMIN_PASSWORD must be set and contain at least 10 characters.');
    console.error('On Windows, run: .\\start.ps1');
    process.exit(1);
  }
  createServer().listen(PORT, HOST, () => {
    console.log(`Student Survey Status is running at http://${HOST}:${PORT}`);
    console.log(`Administrator page: http://${HOST}:${PORT}/admin`);
  });
}

module.exports = { createServer };
