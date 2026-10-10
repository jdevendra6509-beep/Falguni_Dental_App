'use strict';

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { open } = require('./db');

const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_DAYS = 30;
const MAX_BODY = 1024 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const PAYMENT_METHODS = ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Cheque', 'Other'];
const APPT_STATUSES = ['scheduled', 'done', 'cancelled', 'no-show'];
const SETTING_KEYS = [
  'clinic_name', 'doctor_name', 'clinic_phone', 'clinic_address',
  'currency', 'country_code', 'reminder_template',
];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- small helpers ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function localToday() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function str(v, max = 2000) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function date(v, { required = false, field = 'date' } = {}) {
  const s = str(v, 10);
  if (!s) {
    if (required) throw new HttpError(400, `${field} is required`);
    return null;
  }
  if (!DATE_RE.test(s) || Number.isNaN(Date.parse(s))) throw new HttpError(400, `${field} must be YYYY-MM-DD`);
  return s;
}

function money(v, { field = 'amount', allowZero = true } = {}) {
  if (v === undefined || v === null || v === '') {
    if (allowZero) return 0;
    throw new HttpError(400, `${field} is required`);
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) throw new HttpError(400, `${field} must be a positive number`);
  return Math.round(n * 100) / 100;
}

function intId(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'invalid id');
  return n;
}

function today(query) {
  try {
    return date(query.get('today')) || localToday();
  } catch {
    return localToday();
  }
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  return [cols.join(','), ...rows.map((r) => cols.map((c) => csvEscape(r[c])).join(','))].join('\r\n');
}

// ---------- domain logic ----------

/**
 * Builds the receivables picture for every patient: billed, paid, balance and an
 * ageing split of the outstanding amount. Payments are applied to the oldest
 * charges first (FIFO), so whatever is left unpaid is aged from its visit date.
 */
function receivables(db, asOf, patientId = null) {
  const where = patientId ? 'WHERE patient_id = ?' : '';
  const args = patientId ? [patientId] : [];
  const charges = db
    .prepare(`SELECT patient_id, date, fee FROM visits ${where ? where + ' AND' : 'WHERE'} fee > 0 ORDER BY patient_id, date, id`)
    .all(...args);
  const paid = db.prepare(`SELECT patient_id, SUM(amount) AS total, MAX(date) AS last FROM payments ${where} GROUP BY patient_id`).all(...args);

  const map = new Map();
  const get = (id) => {
    if (!map.has(id)) map.set(id, { patient_id: id, billed: 0, paid: 0, balance: 0, last_payment: null, oldest_due: null, aging: { d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 }, charges: [] });
    return map.get(id);
  };
  for (const c of charges) {
    const r = get(c.patient_id);
    r.billed += c.fee;
    r.charges.push(c);
  }
  for (const p of paid) {
    const r = get(p.patient_id);
    r.paid = p.total;
    r.last_payment = p.last;
  }
  for (const r of map.values()) {
    r.billed = Math.round(r.billed * 100) / 100;
    r.paid = Math.round(r.paid * 100) / 100;
    r.balance = Math.round((r.billed - r.paid) * 100) / 100;
    let credit = r.paid;
    for (const c of r.charges) {
      const applied = Math.min(credit, c.fee);
      credit -= applied;
      const open = Math.round((c.fee - applied) * 100) / 100;
      if (open <= 0) continue;
      if (!r.oldest_due) r.oldest_due = c.date;
      const age = daysBetween(c.date, asOf);
      const bucket = age <= 30 ? 'd0_30' : age <= 60 ? 'd31_60' : age <= 90 ? 'd61_90' : 'd90_plus';
      r.aging[bucket] = Math.round((r.aging[bucket] + open) * 100) / 100;
    }
    delete r.charges;
  }
  return map;
}

function balanceFor(db, patientId, asOf) {
  return receivables(db, asOf, patientId).get(patientId) || {
    patient_id: patientId, billed: 0, paid: 0, balance: 0, last_payment: null, oldest_due: null,
    aging: { d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 },
  };
}

function readPatient(body) {
  const name = str(body.name, 200);
  if (!name) throw new HttpError(400, 'Patient name is required');
  let age = null;
  if (body.age !== undefined && body.age !== null && body.age !== '') {
    age = Number(body.age);
    if (!Number.isInteger(age) || age < 0 || age > 130) throw new HttpError(400, 'Age must be a whole number');
  }
  const gender = str(body.gender, 20);
  return {
    name,
    phone: str(body.phone, 30),
    email: str(body.email, 200),
    gender,
    dob: date(body.dob, { field: 'Date of birth' }),
    age,
    address: str(body.address, 500),
    medical_history: str(body.medical_history),
    allergies: str(body.allergies, 500),
    notes: str(body.notes),
  };
}

function readVisit(body) {
  return {
    date: date(body.date, { required: true }),
    complaint: str(body.complaint),
    diagnosis: str(body.diagnosis),
    treatment: str(body.treatment),
    teeth: str(body.teeth, 300),
    notes: str(body.notes),
    fee: money(body.fee, { field: 'Fee' }),
    next_visit: date(body.next_visit, { field: 'Next visit' }),
  };
}

function readPayment(body) {
  const method = str(body.method, 30) || 'Cash';
  return {
    date: date(body.date, { required: true }),
    amount: money(body.amount, { field: 'Amount', allowZero: false }),
    method: PAYMENT_METHODS.includes(method) ? method : 'Other',
    note: str(body.note, 500),
  };
}

function readAppointment(body) {
  const status = str(body.status, 20) || 'scheduled';
  const time = str(body.time, 5);
  if (time && !TIME_RE.test(time)) throw new HttpError(400, 'time must be HH:MM');
  if (!APPT_STATUSES.includes(status)) throw new HttpError(400, 'invalid status');
  return {
    date: date(body.date, { required: true }),
    time,
    purpose: str(body.purpose, 300),
    status,
  };
}

function insert(db, table, row) {
  const cols = Object.keys(row);
  const res = db
    .prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map((c) => row[c]));
  return Number(res.lastInsertRowid);
}

function update(db, table, id, row, extra = '') {
  const cols = Object.keys(row);
  const res = db
    .prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')}${extra} WHERE id = ?`)
    .run(...cols.map((c) => row[c]), id);
  if (res.changes === 0) throw new HttpError(404, 'Not found');
}

function remove(db, table, id) {
  const res = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  if (res.changes === 0) throw new HttpError(404, 'Not found');
}

function requirePatient(db, id) {
  const p = db.prepare('SELECT * FROM patients WHERE id = ?').get(id);
  if (!p) throw new HttpError(404, 'Patient not found');
  return p;
}

function settingsObject(db) {
  const out = {};
  for (const { key, value } of db.prepare('SELECT key, value FROM settings').all()) {
    if (SETTING_KEYS.includes(key)) out[key] = value;
  }
  return out;
}

// ---------- app ----------

function createApp({ dbFile = process.env.DB_FILE || path.join(__dirname, 'data', 'clinic.db') } = {}) {
  const db = open(dbFile);
  const loginAttempts = new Map();
  const routes = [];
  const route = (method, pattern, handler, opts = {}) => routes.push({ method, pattern, handler, auth: opts.auth !== false });

  const getSetting = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;
  const setSetting = (key, value) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);

  function sessionFrom(req) {
    const token = parseCookies(req.headers.cookie).sid;
    if (!token) return null;
    const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    if (!row) return null;
    const now = Date.now();
    if (now - row.last_seen > SESSION_DAYS * 86400000) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      return null;
    }
    if (now - row.last_seen > 60000) db.prepare('UPDATE sessions SET last_seen = ? WHERE token = ?').run(now, token);
    return row;
  }

  function startSession(req, res) {
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    db.prepare('INSERT INTO sessions (token, created_at, last_seen) VALUES (?, ?, ?)').run(token, now, now);
    const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
    res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`);
  }

  // --- auth ---
  route('GET', '/api/status', (ctx) => ({
    setup_required: !getSetting('password_hash'),
    authenticated: !!ctx.session,
    clinic_name: getSetting('clinic_name'),
  }), { auth: false });

  route('POST', '/api/setup', (ctx) => {
    if (getSetting('password_hash')) throw new HttpError(409, 'Already set up');
    const password = String(ctx.body.password || '');
    if (password.length < 4) throw new HttpError(400, 'Password must be at least 4 characters');
    setSetting('password_hash', hashPassword(password));
    const clinic = str(ctx.body.clinic_name, 200);
    if (clinic) setSetting('clinic_name', clinic);
    const doctor = str(ctx.body.doctor_name, 200);
    if (doctor) setSetting('doctor_name', doctor);
    startSession(ctx.req, ctx.res);
    return { ok: true };
  }, { auth: false });

  route('POST', '/api/login', (ctx) => {
    const ip = ctx.req.socket.remoteAddress || 'local';
    const a = loginAttempts.get(ip) || { count: 0, until: 0 };
    if (a.until > Date.now()) throw new HttpError(429, 'Too many attempts. Try again in a minute.');
    if (!verifyPassword(String(ctx.body.password || ''), getSetting('password_hash'))) {
      a.count += 1;
      if (a.count >= 5) { a.count = 0; a.until = Date.now() + 60000; }
      loginAttempts.set(ip, a);
      throw new HttpError(401, 'Wrong password');
    }
    loginAttempts.delete(ip);
    startSession(ctx.req, ctx.res);
    return { ok: true };
  }, { auth: false });

  route('POST', '/api/logout', (ctx) => {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(ctx.session.token);
    ctx.res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return { ok: true };
  });

  route('POST', '/api/password', (ctx) => {
    if (!verifyPassword(String(ctx.body.current || ''), getSetting('password_hash'))) throw new HttpError(400, 'Current password is wrong');
    const next = String(ctx.body.password || '');
    if (next.length < 4) throw new HttpError(400, 'New password must be at least 4 characters');
    setSetting('password_hash', hashPassword(next));
    db.prepare('DELETE FROM sessions WHERE token != ?').run(ctx.session.token);
    return { ok: true };
  });

  // --- settings ---
  route('GET', '/api/settings', () => settingsObject(db));
  route('PUT', '/api/settings', (ctx) => {
    for (const key of SETTING_KEYS) {
      if (key in ctx.body) setSetting(key, str(ctx.body[key], 1000) ?? '');
    }
    return settingsObject(db);
  });

  // --- dashboard ---
  route('GET', '/api/dashboard', (ctx) => {
    const t = today(ctx.query);
    const month = t.slice(0, 7);
    const ar = [...receivables(db, t).values()];
    const one = (sql, ...a) => db.prepare(sql).get(...a);
    return {
      today: t,
      patients: one('SELECT COUNT(*) AS n FROM patients').n,
      new_this_month: one("SELECT COUNT(*) AS n FROM patients WHERE substr(created_at, 1, 7) = ?", month).n,
      collected_today: one('SELECT COALESCE(SUM(amount), 0) AS s FROM payments WHERE date = ?', t).s,
      collected_month: one('SELECT COALESCE(SUM(amount), 0) AS s FROM payments WHERE substr(date, 1, 7) = ?', month).s,
      billed_month: one('SELECT COALESCE(SUM(fee), 0) AS s FROM visits WHERE substr(date, 1, 7) = ?', month).s,
      visits_today: one('SELECT COUNT(*) AS n FROM visits WHERE date = ?', t).n,
      outstanding: Math.round(ar.reduce((s, r) => s + Math.max(r.balance, 0), 0) * 100) / 100,
      patients_with_dues: ar.filter((r) => r.balance > 0).length,
      appointments_today: db.prepare(`
        SELECT a.*, p.name AS patient_name, p.phone AS patient_phone
        FROM appointments a JOIN patients p ON p.id = a.patient_id
        WHERE a.date = ? ORDER BY (a.time IS NULL), a.time, a.id`).all(t),
      followups: db.prepare(`
        SELECT v.id, v.patient_id, v.next_visit, v.treatment, p.name AS patient_name, p.phone AS patient_phone
        FROM visits v JOIN patients p ON p.id = v.patient_id
        WHERE v.next_visit BETWEEN ? AND date(?, '+7 days')
          AND v.id = (SELECT id FROM visits v2 WHERE v2.patient_id = v.patient_id ORDER BY date DESC, id DESC LIMIT 1)
          AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = v.patient_id AND a.date >= ? AND a.status = 'scheduled')
        ORDER BY v.next_visit LIMIT 20`).all(t, t, t),
      recent_visits: db.prepare(`
        SELECT v.id, v.patient_id, v.date, v.treatment, v.fee, p.name AS patient_name
        FROM visits v JOIN patients p ON p.id = v.patient_id
        ORDER BY v.date DESC, v.id DESC LIMIT 5`).all(),
    };
  });

  // --- patients ---
  route('GET', '/api/patients', (ctx) => {
    const q = str(ctx.query.get('q'), 100);
    const filter = ctx.query.get('filter');
    const t = today(ctx.query);
    let rows;
    if (q) {
      const like = `%${q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
      const digits = q.replace(/\D/g, '');
      const idMatch = /^p?-?0*(\d+)$/i.exec(q);
      rows = db.prepare(`
        SELECT * FROM patients
        WHERE name LIKE ? ESCAPE '\\'
           OR (? != '' AND replace(replace(replace(phone, ' ', ''), '-', ''), '+', '') LIKE ?)
           OR id = ?
        ORDER BY name COLLATE NOCASE LIMIT 200`).all(like, digits, `%${digits}%`, idMatch ? Number(idMatch[1]) : -1);
    } else {
      rows = db.prepare(`
        SELECT p.* FROM patients p
        LEFT JOIN (SELECT patient_id, MAX(date) AS d FROM visits GROUP BY patient_id) lv ON lv.patient_id = p.id
        ORDER BY COALESCE(lv.d, substr(p.created_at, 1, 10)) DESC, p.id DESC LIMIT 500`).all();
    }
    const ar = receivables(db, t);
    const lastVisit = new Map(db.prepare('SELECT patient_id, MAX(date) AS d FROM visits GROUP BY patient_id').all().map((r) => [r.patient_id, r.d]));
    rows = rows.map((p) => ({ ...p, balance: ar.get(p.id)?.balance || 0, last_visit: lastVisit.get(p.id) || null }));
    if (filter === 'due') rows = rows.filter((p) => p.balance > 0);
    return rows;
  });

  route('POST', '/api/patients', (ctx) => {
    const id = insert(db, 'patients', readPatient(ctx.body));
    return requirePatient(db, id);
  });

  route('GET', /^\/api\/patients\/(\d+)$/, (ctx) => {
    const id = intId(ctx.params[0]);
    const patient = requirePatient(db, id);
    return {
      patient,
      account: balanceFor(db, id, today(ctx.query)),
      visits: db.prepare('SELECT * FROM visits WHERE patient_id = ? ORDER BY date DESC, id DESC').all(id),
      payments: db.prepare('SELECT * FROM payments WHERE patient_id = ? ORDER BY date DESC, id DESC').all(id),
      appointments: db.prepare('SELECT * FROM appointments WHERE patient_id = ? ORDER BY date DESC, time DESC').all(id),
    };
  });

  route('PUT', /^\/api\/patients\/(\d+)$/, (ctx) => {
    const id = intId(ctx.params[0]);
    update(db, 'patients', id, readPatient(ctx.body), ", updated_at = datetime('now')");
    return requirePatient(db, id);
  });

  route('DELETE', /^\/api\/patients\/(\d+)$/, (ctx) => {
    remove(db, 'patients', intId(ctx.params[0]));
    return { ok: true };
  });

  // --- visits ---
  route('POST', /^\/api\/patients\/(\d+)\/visits$/, (ctx) => {
    const pid = intId(ctx.params[0]);
    requirePatient(db, pid);
    const visit = readVisit(ctx.body);
    const paidNow = money(ctx.body.paid_now, { field: 'Paid now' });
    db.exec('BEGIN');
    try {
      const id = insert(db, 'visits', { patient_id: pid, ...visit });
      if (paidNow > 0) {
        const method = str(ctx.body.paid_method, 30) || 'Cash';
        insert(db, 'payments', {
          patient_id: pid, date: visit.date, amount: paidNow,
          method: PAYMENT_METHODS.includes(method) ? method : 'Other',
          note: visit.treatment ? `For: ${visit.treatment}`.slice(0, 500) : null,
        });
      }
      if (visit.next_visit && ctx.body.book_next) {
        insert(db, 'appointments', { patient_id: pid, date: visit.next_visit, time: null, purpose: visit.treatment ? `Follow-up: ${visit.treatment}`.slice(0, 300) : 'Follow-up', status: 'scheduled' });
      }
      db.exec('COMMIT');
      return db.prepare('SELECT * FROM visits WHERE id = ?').get(id);
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  });

  route('PUT', /^\/api\/visits\/(\d+)$/, (ctx) => {
    const id = intId(ctx.params[0]);
    update(db, 'visits', id, readVisit(ctx.body));
    return db.prepare('SELECT * FROM visits WHERE id = ?').get(id);
  });

  route('DELETE', /^\/api\/visits\/(\d+)$/, (ctx) => {
    remove(db, 'visits', intId(ctx.params[0]));
    return { ok: true };
  });

  // --- payments ---
  route('POST', /^\/api\/patients\/(\d+)\/payments$/, (ctx) => {
    const pid = intId(ctx.params[0]);
    requirePatient(db, pid);
    const id = insert(db, 'payments', { patient_id: pid, ...readPayment(ctx.body) });
    return db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
  });

  route('PUT', /^\/api\/payments\/(\d+)$/, (ctx) => {
    const id = intId(ctx.params[0]);
    update(db, 'payments', id, readPayment(ctx.body));
    return db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
  });

  route('DELETE', /^\/api\/payments\/(\d+)$/, (ctx) => {
    remove(db, 'payments', intId(ctx.params[0]));
    return { ok: true };
  });

  // --- appointments ---
  route('GET', '/api/appointments', (ctx) => {
    const from = date(ctx.query.get('from')) || today(ctx.query);
    const to = date(ctx.query.get('to')) || from;
    return db.prepare(`
      SELECT a.*, p.name AS patient_name, p.phone AS patient_phone
      FROM appointments a JOIN patients p ON p.id = a.patient_id
      WHERE a.date BETWEEN ? AND ? ORDER BY a.date, (a.time IS NULL), a.time, a.id`).all(from, to);
  });

  route('GET', /^\/api\/appointments\/(\d+)$/, (ctx) => {
    const a = db.prepare(`
      SELECT a.*, p.name AS patient_name, p.phone AS patient_phone
      FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE a.id = ?`).get(intId(ctx.params[0]));
    if (!a) throw new HttpError(404, 'Appointment not found');
    return a;
  });

  route('POST', '/api/appointments', (ctx) => {
    const pid = intId(ctx.body.patient_id);
    requirePatient(db, pid);
    const id = insert(db, 'appointments', { patient_id: pid, ...readAppointment(ctx.body) });
    return db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  });

  route('PUT', /^\/api\/appointments\/(\d+)$/, (ctx) => {
    const id = intId(ctx.params[0]);
    const existing = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
    if (!existing) throw new HttpError(404, 'Not found');
    update(db, 'appointments', id, readAppointment({ ...existing, ...ctx.body }));
    return db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  });

  route('DELETE', /^\/api\/appointments\/(\d+)$/, (ctx) => {
    remove(db, 'appointments', intId(ctx.params[0]));
    return { ok: true };
  });

  // --- accounts receivable ---
  route('GET', '/api/receivables', (ctx) => {
    const t = today(ctx.query);
    const ar = receivables(db, t);
    const patients = new Map(db.prepare('SELECT id, name, phone FROM patients').all().map((p) => [p.id, p]));
    const rows = [...ar.values()]
      .filter((r) => r.balance > 0 && patients.has(r.patient_id))
      .map((r) => ({ ...r, name: patients.get(r.patient_id).name, phone: patients.get(r.patient_id).phone, days_overdue: r.oldest_due ? daysBetween(r.oldest_due, t) : 0 }))
      .sort((a, b) => b.balance - a.balance);
    const totals = { balance: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
    for (const r of rows) {
      totals.balance += r.balance;
      for (const k of ['d0_30', 'd31_60', 'd61_90', 'd90_plus']) totals[k] += r.aging[k];
    }
    for (const k of Object.keys(totals)) totals[k] = Math.round(totals[k] * 100) / 100;
    const advances = [...ar.values()].filter((r) => r.balance < 0 && patients.has(r.patient_id))
      .map((r) => ({ patient_id: r.patient_id, name: patients.get(r.patient_id).name, credit: -r.balance }));
    return { as_of: t, totals, rows, advances };
  });

  // --- reports ---
  route('GET', '/api/reports', (ctx) => {
    const t = today(ctx.query);
    const from = date(ctx.query.get('from')) || `${t.slice(0, 7)}-01`;
    const to = date(ctx.query.get('to')) || t;
    const one = (sql) => db.prepare(sql).get(from, to);
    const daily = new Map();
    const day = (d) => {
      if (!daily.has(d)) daily.set(d, { date: d, visits: 0, billed: 0, collected: 0 });
      return daily.get(d);
    };
    for (const r of db.prepare('SELECT date, COUNT(*) AS n, SUM(fee) AS s FROM visits WHERE date BETWEEN ? AND ? GROUP BY date').all(from, to)) {
      Object.assign(day(r.date), { visits: r.n, billed: r.s });
    }
    for (const r of db.prepare('SELECT date, SUM(amount) AS s FROM payments WHERE date BETWEEN ? AND ? GROUP BY date').all(from, to)) {
      day(r.date).collected = r.s;
    }
    return {
      from, to,
      billed: one('SELECT COALESCE(SUM(fee), 0) AS s FROM visits WHERE date BETWEEN ? AND ?').s,
      collected: one('SELECT COALESCE(SUM(amount), 0) AS s FROM payments WHERE date BETWEEN ? AND ?').s,
      visits: one('SELECT COUNT(*) AS n FROM visits WHERE date BETWEEN ? AND ?').n,
      patients_seen: one('SELECT COUNT(DISTINCT patient_id) AS n FROM visits WHERE date BETWEEN ? AND ?').n,
      new_patients: one('SELECT COUNT(*) AS n FROM patients WHERE substr(created_at, 1, 10) BETWEEN ? AND ?').n,
      by_method: db.prepare('SELECT method, SUM(amount) AS total, COUNT(*) AS count FROM payments WHERE date BETWEEN ? AND ? GROUP BY method ORDER BY total DESC').all(from, to),
      top_treatments: db.prepare(`
        SELECT treatment, COUNT(*) AS count, SUM(fee) AS total FROM visits
        WHERE date BETWEEN ? AND ? AND treatment IS NOT NULL
        GROUP BY lower(treatment) ORDER BY count DESC LIMIT 10`).all(from, to),
      daily: [...daily.values()].sort((a, b) => b.date.localeCompare(a.date)),
    };
  });

  // --- export & backup ---
  route('GET', /^\/api\/export\/(patients|visits|payments|appointments|receivables)\.csv$/, (ctx) => {
    const kind = ctx.params[0];
    let rows;
    if (kind === 'receivables') {
      const t = today(ctx.query);
      const names = new Map(db.prepare('SELECT id, name, phone FROM patients').all().map((p) => [p.id, p]));
      rows = [...receivables(db, t).values()].filter((r) => r.balance !== 0 && names.has(r.patient_id)).map((r) => ({
        patient_id: r.patient_id, name: names.get(r.patient_id).name, phone: names.get(r.patient_id).phone,
        billed: r.billed, paid: r.paid, balance: r.balance,
        '0-30 days': r.aging.d0_30, '31-60 days': r.aging.d31_60, '61-90 days': r.aging.d61_90, '90+ days': r.aging.d90_plus,
        oldest_due: r.oldest_due, last_payment: r.last_payment,
      }));
    } else if (kind === 'patients') {
      rows = db.prepare('SELECT * FROM patients ORDER BY id').all();
    } else {
      rows = db.prepare(`SELECT t.*, p.name AS patient_name FROM ${kind} t JOIN patients p ON p.id = t.patient_id ORDER BY t.date, t.id`).all();
    }
    return { raw: '﻿' + toCsv(rows), type: 'text/csv; charset=utf-8', filename: `${kind}-${localToday()}.csv` };
  });

  route('GET', '/api/backup', () => {
    const tmp = path.join(os.tmpdir(), `clinic-backup-${crypto.randomBytes(6).toString('hex')}.db`);
    db.prepare('VACUUM INTO ?').run(tmp);
    const buf = fs.readFileSync(tmp);
    fs.unlinkSync(tmp);
    return { raw: buf, type: 'application/vnd.sqlite3', filename: `clinic-backup-${localToday()}.db` };
  });

  // ---------- request handling ----------

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(new HttpError(413, 'Request too large'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(parsed && typeof parsed === 'object' ? parsed : {});
        } catch {
          reject(new HttpError(400, 'Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel === '/' || !path.extname(rel)) rel = '/index.html';
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
        return;
      }
      const ext = path.extname(file);
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': ext === '.html' || file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=300',
      });
      res.end(data);
    });
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');

    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end();
      return serveStatic(req, res, url.pathname);
    }

    res.setHeader('Cache-Control', 'no-store');
    try {
      let match = null;
      let r = null;
      for (const candidate of routes) {
        if (candidate.method !== req.method) continue;
        if (typeof candidate.pattern === 'string') {
          if (candidate.pattern === url.pathname) { r = candidate; match = []; break; }
        } else {
          const m = candidate.pattern.exec(url.pathname);
          if (m) { r = candidate; match = m.slice(1); break; }
        }
      }
      if (!r) throw new HttpError(404, 'Not found');

      const session = sessionFrom(req);
      if (r.auth && !session) throw new HttpError(401, 'Please log in');
      // Basic CSRF defence: state-changing requests must come from our own page (JSON + same origin).
      if (req.method !== 'GET') {
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Bad origin');
        if (!String(req.headers['content-type'] || '').includes('application/json') && req.headers['content-length'] !== '0' && req.headers['content-length'] !== undefined) {
          throw new HttpError(415, 'Expected JSON');
        }
      }
      const body = req.method === 'GET' ? {} : await readBody(req);
      const result = await r.handler({ req, res, body, query: url.searchParams, params: match, session });

      if (result && result.raw !== undefined) {
        res.writeHead(200, {
          'Content-Type': result.type,
          'Content-Disposition': `attachment; filename="${result.filename}"`,
        });
        return res.end(result.raw);
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result ?? { ok: true }));
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: status === 500 ? 'Something went wrong' : err.message }));
    }
  }

  const server = http.createServer((req, res) => {
    handle(req, res);
  });
  server.db = db;
  server.on('close', () => db.close());
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  createApp().listen(port, host, () => {
    console.log(`Dental clinic app running at http://localhost:${port}`);
    for (const list of Object.values(os.networkInterfaces())) {
      for (const n of list || []) {
        if (n.family === 'IPv4' && !n.internal) console.log(`  On your phone (same Wi-Fi): http://${n.address}:${port}`);
      }
    }
  });
}

module.exports = { createApp, receivables };
