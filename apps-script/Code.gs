/**
 * Falguni Dental App — Google Apps Script backend.
 *
 * All data lives in the tabs of the spreadsheet this script is attached to:
 * Patients, Visits, Payments, Appointments and Settings. The web page (Index.html)
 * calls api(method, url, body) through google.script.run.
 */

const SCHEMA = {
  Patients: ['id', 'name', 'phone', 'email', 'gender', 'dob', 'age', 'address', 'medical_history', 'allergies', 'notes', 'created_at', 'updated_at'],
  // A visit is one clinical encounter. Its fee is the amount billed (a receivable).
  Visits: ['id', 'patient_id', 'patient_name', 'date', 'complaint', 'diagnosis', 'treatment', 'teeth', 'notes', 'fee', 'next_visit', 'created_at'],
  Payments: ['id', 'patient_id', 'patient_name', 'date', 'amount', 'method', 'note', 'created_at'],
  Appointments: ['id', 'patient_id', 'patient_name', 'date', 'time', 'purpose', 'status', 'created_at'],
  Settings: ['key', 'value'],
};
const NUMBER_FORMATS = { id: '0', patient_id: '0', age: '0', fee: '#,##0.00', amount: '#,##0.00' };
const DATETIME_COLS = { created_at: true, updated_at: true };

const PAYMENT_METHODS = ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Cheque', 'Other'];
const APPT_STATUSES = ['scheduled', 'done', 'cancelled', 'no-show'];
const SETTING_KEYS = ['clinic_name', 'doctor_name', 'clinic_phone', 'clinic_address', 'currency', 'country_code', 'reminder_template', 'setup_done'];
const DEFAULT_SETTINGS = {
  clinic_name: 'Falguni Dental Clinic',
  doctor_name: '',
  clinic_phone: '',
  clinic_address: '',
  currency: '₹',
  country_code: '91',
  reminder_template:
    'Hello {name}, this is a gentle reminder from {clinic} that an amount of {amount} is pending for your dental treatment. Thank you!',
  setup_done: '',
};
const DUES_SHEET = 'Dues Report';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ======================================================================
   Entry points
   ====================================================================== */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(getSettings().clinic_name || 'Dental Clinic')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** Run once from the Apps Script editor to create the tabs and grant permissions. */
function setup() {
  ensureSheets();
  return 'Sheets are ready: ' + Object.keys(SCHEMA).join(', ');
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🦷 Dental App')
    .addItem('Set up / repair sheets', 'setup')
    .addToUi();
}

/**
 * The single API used by the web page. Returns a JSON string:
 * { ok: true, data } on success, { ok: false, status, error } on failure.
 */
function api(method, url, body) {
  let lock = null;
  try {
    if (method !== 'GET') {
      lock = LockService.getScriptLock();
      lock.waitLock(30000);
    }
    ensureSheets(!!lock);
    tableCache = {};
    const req = parseUrl(url);
    for (let i = 0; i < ROUTES.length; i++) {
      const r = ROUTES[i];
      if (r[0] !== method) continue;
      const m = r[1].exec(req.path);
      if (!m) continue;
      const data = r[2]({ body: body || {}, query: req.query, params: m.slice(1) });
      return JSON.stringify({ ok: true, data: data === undefined ? { ok: true } : data });
    }
    throw new HttpError(404, 'Not found');
  } catch (e) {
    const status = (e && e.status) || 500;
    if (status === 500) console.error(e && e.stack ? e.stack : e);
    return JSON.stringify({ ok: false, status: status, error: status === 500 ? 'Something went wrong: ' + (e && e.message) : e.message });
  } finally {
    if (lock) lock.releaseLock();
  }
}

/* ======================================================================
   Spreadsheet storage
   ====================================================================== */

let ss_ = null;
let sheetsReady = false;
let tableCache = {};

function ss() {
  if (!ss_) ss_ = SpreadsheetApp.getActiveSpreadsheet();
  return ss_;
}

function timeZone() {
  return ss().getSpreadsheetTimeZone() || Session.getScriptTimeZone();
}

function formatFor(col) {
  return NUMBER_FORMATS[col] || '@';
}

function ensureSheets(haveLock) {
  if (sheetsReady) return;
  const missing = Object.keys(SCHEMA).filter((name) => {
    const sh = ss().getSheetByName(name);
    return !sh || sh.getLastRow() === 0;
  });
  const settingsMissing = () => {
    const have = {};
    new Table('Settings').load().forEach((r) => { have[r.key] = true; });
    return Object.keys(DEFAULT_SETTINGS).filter((k) => !have[k]);
  };
  if (missing.length || settingsMissing().length) {
    let lock = null;
    if (!haveLock) {
      lock = LockService.getScriptLock();
      lock.waitLock(30000);
    }
    try {
      Object.keys(SCHEMA).forEach((name) => {
        let sh = ss().getSheetByName(name);
        if (!sh) sh = ss().insertSheet(name);
        if (sh.getLastRow() === 0) {
          const cols = SCHEMA[name];
          const header = sh.getRange(1, 1, 1, cols.length);
          header.setValues([cols]);
          header.setFontWeight('bold');
          header.setBackground('#d9f2ef');
          sh.setFrozenRows(1);
          // Pre-format columns so Sheets doesn't turn dates, times or phone numbers into something else.
          const rows = Math.max(sh.getMaxRows() - 1, 1);
          sh.getRange(2, 1, rows, cols.length).setNumberFormats(
            Array.from({ length: rows }, () => cols.map(formatFor)),
          );
        }
      });
      const settings = new Table('Settings');
      settingsMissing().forEach((k) => settings.insert({ key: k, value: DEFAULT_SETTINGS[k] }));
    } finally {
      if (lock) lock.releaseLock();
    }
  }
  sheetsReady = true;
}

function readCell(col, v, tz) {
  if (v === '' || v === null || v === undefined) return null;
  if (NUMBER_FORMATS[col]) {
    const n = Number(v);
    return isFinite(n) ? n : null;
  }
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, tz, col === 'time' ? 'HH:mm' : DATETIME_COLS[col] ? 'yyyy-MM-dd HH:mm:ss' : 'yyyy-MM-dd');
  }
  return String(v);
}

function writeCell(col, v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return v;
  const s = String(v);
  // A leading apostrophe keeps text like "+91 98..." or "=..." from being read as a formula.
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function nowStamp() {
  return Utilities.formatDate(new Date(), timeZone(), 'yyyy-MM-dd HH:mm:ss');
}

class Table {
  constructor(name) {
    this.name = name;
    this.cols = SCHEMA[name];
    this.sheet = ss().getSheetByName(name);
    this.rows = null;
  }

  load() {
    if (this.rows) return this.rows;
    const last = this.sheet.getLastRow();
    const values = last > 1 ? this.sheet.getRange(2, 1, last - 1, this.cols.length).getValues() : [];
    const tz = timeZone();
    this.rows = [];
    values.forEach((v, i) => {
      if (v.every((x) => x === '' || x === null)) return;
      const o = {};
      this.cols.forEach((c, j) => { o[c] = readCell(c, v[j], tz); });
      Object.defineProperty(o, '_row', { value: i + 2, enumerable: false, writable: true });
      this.rows.push(o);
    });
    return this.rows;
  }

  all() {
    return this.load().slice();
  }

  get(id) {
    return this.load().find((r) => r.id === id) || null;
  }

  writeRow(rowNum, obj) {
    const max = this.sheet.getMaxRows();
    if (rowNum > max) this.sheet.insertRowsAfter(max, Math.max(50, rowNum - max));
    const range = this.sheet.getRange(rowNum, 1, 1, this.cols.length);
    range.setNumberFormats([this.cols.map(formatFor)]);
    range.setValues([this.cols.map((c) => writeCell(c, obj[c]))]);
  }

  insert(data) {
    const rows = this.load();
    const obj = {};
    this.cols.forEach((c) => { obj[c] = data[c] === undefined ? null : data[c]; });
    if (this.cols.indexOf('id') >= 0) obj.id = rows.reduce((m, r) => Math.max(m, r.id || 0), 0) + 1;
    if (this.cols.indexOf('created_at') >= 0) obj.created_at = nowStamp();
    if (this.cols.indexOf('updated_at') >= 0) obj.updated_at = obj.created_at;
    const rowNum = Math.max(this.sheet.getLastRow(), 1) + 1;
    this.writeRow(rowNum, obj);
    Object.defineProperty(obj, '_row', { value: rowNum, enumerable: false, writable: true });
    rows.push(obj);
    return obj;
  }

  update(id, patch) {
    const row = this.get(id);
    if (!row) throw new HttpError(404, 'Not found');
    Object.keys(patch).forEach((k) => { if (this.cols.indexOf(k) >= 0 && k !== 'id') row[k] = patch[k]; });
    if (this.cols.indexOf('updated_at') >= 0) row.updated_at = nowStamp();
    this.writeRow(row._row, row);
    return row;
  }

  removeWhere(pred) {
    const doomed = this.load().filter(pred).map((r) => r._row).sort((a, b) => b - a);
    doomed.forEach((r) => this.sheet.deleteRow(r));
    this.rows = null;
    return doomed.length;
  }

  remove(id) {
    if (!this.removeWhere((r) => r.id === id)) throw new HttpError(404, 'Not found');
  }
}

function table(name) {
  if (!tableCache[name]) tableCache[name] = new Table(name);
  return tableCache[name];
}

function getSettings() {
  ensureSheets();
  const out = {};
  Object.keys(DEFAULT_SETTINGS).forEach((k) => { out[k] = DEFAULT_SETTINGS[k]; });
  new Table('Settings').load().forEach((r) => {
    if (SETTING_KEYS.indexOf(r.key) >= 0) out[r.key] = r.value === null ? '' : r.value;
  });
  return out;
}

function setSetting(key, value) {
  const t = table('Settings');
  const row = t.load().find((r) => r.key === key);
  if (row) {
    row.value = value;
    t.writeRow(row._row, row);
  } else {
    t.insert({ key: key, value: value });
  }
}

/* ======================================================================
   Validation helpers
   ====================================================================== */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function str(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max || 2000) : null;
}

function date(v, opts) {
  opts = opts || {};
  const field = opts.field || 'date';
  const s = str(v, 10);
  if (!s) {
    if (opts.required) throw new HttpError(400, field + ' is required');
    return null;
  }
  if (!DATE_RE.test(s) || isNaN(Date.parse(s))) throw new HttpError(400, field + ' must be YYYY-MM-DD');
  return s;
}

function money(v, opts) {
  opts = opts || {};
  const field = opts.field || 'amount';
  const allowZero = opts.allowZero !== false;
  if (v === undefined || v === null || v === '') {
    if (allowZero) return 0;
    throw new HttpError(400, field + ' is required');
  }
  const n = Number(v);
  if (!isFinite(n) || n < 0 || (!allowZero && n === 0)) throw new HttpError(400, field + ' must be a positive number');
  return round2(n);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function intId(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'invalid id');
  return n;
}

function localToday() {
  return Utilities.formatDate(new Date(), timeZone(), 'yyyy-MM-dd');
}

function today(query) {
  try {
    return date(query.today) || localToday();
  } catch (e) {
    return localToday();
  }
}

function addDays(s, n) {
  const d = new Date(Date.parse(s) + n * 86400000);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

function parseUrl(url) {
  const i = url.indexOf('?');
  const path = i < 0 ? url : url.slice(0, i);
  const query = {};
  (i < 0 ? '' : url.slice(i + 1)).split('&').forEach((p) => {
    if (!p) return;
    const j = p.indexOf('=');
    const k = decodeURIComponent(j < 0 ? p : p.slice(0, j));
    query[k] = j < 0 ? '' : decodeURIComponent(p.slice(j + 1).replace(/\+/g, ' '));
  });
  return { path: path, query: query };
}

function byDateDesc(a, b) {
  return String(b.date).localeCompare(String(a.date)) || b.id - a.id;
}

/* ======================================================================
   Domain logic
   ====================================================================== */

function emptyAccount(patientId) {
  return {
    patient_id: patientId, billed: 0, paid: 0, balance: 0, last_payment: null, oldest_due: null,
    aging: { d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 },
  };
}

/**
 * Builds the receivables picture for every patient: billed, paid, balance and an
 * ageing split of the outstanding amount. Payments are applied to the oldest
 * charges first (FIFO), so whatever is left unpaid is aged from its visit date.
 */
function receivables(asOf, patientId) {
  const map = {};
  const get = (id) => {
    if (!map[id]) {
      map[id] = emptyAccount(id);
      map[id].charges = [];
    }
    return map[id];
  };
  table('Visits').load()
    .filter((v) => v.fee > 0 && (!patientId || v.patient_id === patientId))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.id - b.id)
    .forEach((v) => {
      const r = get(v.patient_id);
      r.billed += v.fee;
      r.charges.push(v);
    });
  table('Payments').load()
    .filter((p) => !patientId || p.patient_id === patientId)
    .forEach((p) => {
      const r = get(p.patient_id);
      r.paid += p.amount || 0;
      if (!r.last_payment || p.date > r.last_payment) r.last_payment = p.date;
    });
  Object.keys(map).forEach((k) => {
    const r = map[k];
    r.billed = round2(r.billed);
    r.paid = round2(r.paid);
    r.balance = round2(r.billed - r.paid);
    let credit = r.paid;
    r.charges.forEach((c) => {
      const applied = Math.min(credit, c.fee);
      credit -= applied;
      const open = round2(c.fee - applied);
      if (open <= 0) return;
      if (!r.oldest_due) r.oldest_due = c.date;
      const age = daysBetween(c.date, asOf);
      const bucket = age <= 30 ? 'd0_30' : age <= 60 ? 'd31_60' : age <= 90 ? 'd61_90' : 'd90_plus';
      r.aging[bucket] = round2(r.aging[bucket] + open);
    });
    delete r.charges;
  });
  return map;
}

function balanceFor(patientId, asOf) {
  return receivables(asOf, patientId)[patientId] || emptyAccount(patientId);
}

function requirePatient(id) {
  const p = table('Patients').get(id);
  if (!p) throw new HttpError(404, 'Patient not found');
  return p;
}

function readPatient(body) {
  const name = str(body.name, 200);
  if (!name) throw new HttpError(400, 'Patient name is required');
  let age = null;
  if (body.age !== undefined && body.age !== null && body.age !== '') {
    age = Number(body.age);
    if (!Number.isInteger(age) || age < 0 || age > 130) throw new HttpError(400, 'Age must be a whole number');
  }
  return {
    name: name,
    phone: str(body.phone, 30),
    email: str(body.email, 200),
    gender: str(body.gender, 20),
    dob: date(body.dob, { field: 'Date of birth' }),
    age: age,
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

function paymentMethod(v) {
  const m = str(v, 30) || 'Cash';
  return PAYMENT_METHODS.indexOf(m) >= 0 ? m : 'Other';
}

function readPayment(body) {
  return {
    date: date(body.date, { required: true }),
    amount: money(body.amount, { field: 'Amount', allowZero: false }),
    method: paymentMethod(body.method),
    note: str(body.note, 500),
  };
}

function readAppointment(body) {
  const status = str(body.status, 20) || 'scheduled';
  const time = str(body.time, 5);
  if (time && !TIME_RE.test(time)) throw new HttpError(400, 'time must be HH:MM');
  if (APPT_STATUSES.indexOf(status) < 0) throw new HttpError(400, 'invalid status');
  return { date: date(body.date, { required: true }), time: time, purpose: str(body.purpose, 300), status: status };
}

function withPatient(rows) {
  const patients = {};
  table('Patients').load().forEach((p) => { patients[p.id] = p; });
  return rows
    .filter((r) => patients[r.patient_id])
    .map((r) => Object.assign({}, r, { patient_name: patients[r.patient_id].name, patient_phone: patients[r.patient_id].phone }));
}

function byTime(a, b) {
  return String(a.date).localeCompare(String(b.date)) ||
    (a.time ? 0 : 1) - (b.time ? 0 : 1) ||
    String(a.time || '').localeCompare(String(b.time || '')) || a.id - b.id;
}

function receivableRows(t) {
  const ar = receivables(t);
  const patients = {};
  table('Patients').load().forEach((p) => { patients[p.id] = p; });
  const rows = Object.keys(ar).map((k) => ar[k]).filter((r) => patients[r.patient_id]);
  return { rows: rows, patients: patients };
}

/* ======================================================================
   Routes
   ====================================================================== */

const ROUTES = [];
function route(method, pattern, handler) {
  ROUTES.push([method, pattern, handler]);
}

// --- settings ---
route('GET', /^\/api\/settings$/, () => {
  const s = getSettings();
  s.spreadsheet_url = ss().getUrl();
  return s;
});

route('PUT', /^\/api\/settings$/, (ctx) => {
  SETTING_KEYS.forEach((key) => {
    if (key in ctx.body) {
      const v = str(ctx.body[key], 1000);
      setSetting(key, v === null ? '' : v);
    }
  });
  const s = getSettings();
  s.spreadsheet_url = ss().getUrl();
  return s;
});

// --- dashboard ---
route('GET', /^\/api\/dashboard$/, (ctx) => {
  const t = today(ctx.query);
  const month = t.slice(0, 7);
  const patients = table('Patients').load();
  const visits = table('Visits').load();
  const payments = table('Payments').load();
  const appts = table('Appointments').load();
  const ar = receivables(t);
  const arRows = Object.keys(ar).map((k) => ar[k]).filter((r) => patients.some((p) => p.id === r.patient_id));
  const sum = (list, f) => round2(list.reduce((s, x) => s + (x[f] || 0), 0));

  // Follow-ups: the latest visit asked for a next visit within 7 days and nothing is booked yet.
  const latest = {};
  visits.forEach((v) => {
    const cur = latest[v.patient_id];
    if (!cur || v.date > cur.date || (v.date === cur.date && v.id > cur.id)) latest[v.patient_id] = v;
  });
  const weekEnd = addDays(t, 7);
  const followups = withPatient(Object.keys(latest).map((k) => latest[k])
    .filter((v) => v.next_visit && v.next_visit >= t && v.next_visit <= weekEnd)
    .filter((v) => !appts.some((a) => a.patient_id === v.patient_id && a.date >= t && a.status === 'scheduled')))
    .sort((a, b) => a.next_visit.localeCompare(b.next_visit))
    .slice(0, 20)
    .map((v) => ({ id: v.id, patient_id: v.patient_id, next_visit: v.next_visit, treatment: v.treatment, patient_name: v.patient_name, patient_phone: v.patient_phone }));

  return {
    today: t,
    patients: patients.length,
    new_this_month: patients.filter((p) => String(p.created_at || '').slice(0, 7) === month).length,
    collected_today: sum(payments.filter((p) => p.date === t), 'amount'),
    collected_month: sum(payments.filter((p) => String(p.date).slice(0, 7) === month), 'amount'),
    billed_month: sum(visits.filter((v) => String(v.date).slice(0, 7) === month), 'fee'),
    visits_today: visits.filter((v) => v.date === t).length,
    outstanding: round2(arRows.reduce((s, r) => s + Math.max(r.balance, 0), 0)),
    patients_with_dues: arRows.filter((r) => r.balance > 0).length,
    appointments_today: withPatient(appts.filter((a) => a.date === t)).sort(byTime),
    followups: followups,
    recent_visits: withPatient(visits.slice().sort(byDateDesc).slice(0, 5))
      .map((v) => ({ id: v.id, patient_id: v.patient_id, date: v.date, treatment: v.treatment, fee: v.fee, patient_name: v.patient_name })),
  };
});

// --- patients ---
route('GET', /^\/api\/patients$/, (ctx) => {
  const q = str(ctx.query.q, 100);
  const t = today(ctx.query);
  const visits = table('Visits').load();
  const lastVisit = {};
  visits.forEach((v) => { if (!lastVisit[v.patient_id] || v.date > lastVisit[v.patient_id]) lastVisit[v.patient_id] = v.date; });
  let rows = table('Patients').all();
  if (q) {
    const needle = q.toLowerCase();
    const digits = q.replace(/\D/g, '');
    const idMatch = /^p?-?0*(\d+)$/i.exec(q);
    rows = rows.filter((p) =>
      String(p.name || '').toLowerCase().indexOf(needle) >= 0 ||
      (digits && String(p.phone || '').replace(/\D/g, '').indexOf(digits) >= 0) ||
      (idMatch && p.id === Number(idMatch[1])))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 200);
  } else {
    const key = (p) => lastVisit[p.id] || String(p.created_at || '').slice(0, 10);
    rows = rows.sort((a, b) => key(b).localeCompare(key(a)) || b.id - a.id).slice(0, 500);
  }
  const ar = receivables(t);
  rows = rows.map((p) => Object.assign({}, p, { balance: ar[p.id] ? ar[p.id].balance : 0, last_visit: lastVisit[p.id] || null }));
  if (ctx.query.filter === 'due') rows = rows.filter((p) => p.balance > 0);
  return rows;
});

route('POST', /^\/api\/patients$/, (ctx) => table('Patients').insert(readPatient(ctx.body)));

route('GET', /^\/api\/patients\/(\d+)$/, (ctx) => {
  const id = intId(ctx.params[0]);
  const patient = requirePatient(id);
  const mine = (name) => table(name).load().filter((r) => r.patient_id === id);
  return {
    patient: patient,
    account: balanceFor(id, today(ctx.query)),
    visits: mine('Visits').sort(byDateDesc),
    payments: mine('Payments').sort(byDateDesc),
    appointments: mine('Appointments').sort((a, b) => byTime(b, a)),
  };
});

route('PUT', /^\/api\/patients\/(\d+)$/, (ctx) => {
  const id = intId(ctx.params[0]);
  const before = requirePatient(id).name;
  const p = table('Patients').update(id, readPatient(ctx.body));
  if (p.name !== before) {
    // Keep the readable patient_name column in the other tabs in step.
    ['Visits', 'Payments', 'Appointments'].forEach((name) => {
      const t = table(name);
      t.load().filter((r) => r.patient_id === id).forEach((r) => {
        r.patient_name = p.name;
        t.writeRow(r._row, r);
      });
    });
  }
  return p;
});

route('DELETE', /^\/api\/patients\/(\d+)$/, (ctx) => {
  const id = intId(ctx.params[0]);
  table('Patients').remove(id);
  ['Visits', 'Payments', 'Appointments'].forEach((name) => table(name).removeWhere((r) => r.patient_id === id));
  return { ok: true };
});

// --- visits ---
route('POST', /^\/api\/patients\/(\d+)\/visits$/, (ctx) => {
  const pid = intId(ctx.params[0]);
  const p = requirePatient(pid);
  const visit = readVisit(ctx.body);
  const paidNow = money(ctx.body.paid_now, { field: 'Paid now' });
  const row = table('Visits').insert(Object.assign({ patient_id: pid, patient_name: p.name }, visit));
  if (paidNow > 0) {
    table('Payments').insert({
      patient_id: pid, patient_name: p.name, date: visit.date, amount: paidNow,
      method: paymentMethod(ctx.body.paid_method),
      note: visit.treatment ? ('For: ' + visit.treatment).slice(0, 500) : null,
    });
  }
  if (visit.next_visit && ctx.body.book_next) {
    table('Appointments').insert({
      patient_id: pid, patient_name: p.name, date: visit.next_visit, time: null,
      purpose: visit.treatment ? ('Follow-up: ' + visit.treatment).slice(0, 300) : 'Follow-up', status: 'scheduled',
    });
  }
  return row;
});

route('PUT', /^\/api\/visits\/(\d+)$/, (ctx) => table('Visits').update(intId(ctx.params[0]), readVisit(ctx.body)));
route('DELETE', /^\/api\/visits\/(\d+)$/, (ctx) => { table('Visits').remove(intId(ctx.params[0])); return { ok: true }; });

// --- payments ---
route('POST', /^\/api\/patients\/(\d+)\/payments$/, (ctx) => {
  const pid = intId(ctx.params[0]);
  const p = requirePatient(pid);
  return table('Payments').insert(Object.assign({ patient_id: pid, patient_name: p.name }, readPayment(ctx.body)));
});
route('PUT', /^\/api\/payments\/(\d+)$/, (ctx) => table('Payments').update(intId(ctx.params[0]), readPayment(ctx.body)));
route('DELETE', /^\/api\/payments\/(\d+)$/, (ctx) => { table('Payments').remove(intId(ctx.params[0])); return { ok: true }; });

// --- appointments ---
route('GET', /^\/api\/appointments$/, (ctx) => {
  const from = date(ctx.query.from) || today(ctx.query);
  const to = date(ctx.query.to) || from;
  return withPatient(table('Appointments').load().filter((a) => a.date >= from && a.date <= to)).sort(byTime);
});

route('GET', /^\/api\/appointments\/(\d+)$/, (ctx) => {
  const a = table('Appointments').get(intId(ctx.params[0]));
  const rows = a ? withPatient([a]) : [];
  if (!rows.length) throw new HttpError(404, 'Appointment not found');
  return rows[0];
});

route('POST', /^\/api\/appointments$/, (ctx) => {
  const pid = intId(ctx.body.patient_id);
  const p = requirePatient(pid);
  return table('Appointments').insert(Object.assign({ patient_id: pid, patient_name: p.name }, readAppointment(ctx.body)));
});

route('PUT', /^\/api\/appointments\/(\d+)$/, (ctx) => {
  const id = intId(ctx.params[0]);
  const existing = table('Appointments').get(id);
  if (!existing) throw new HttpError(404, 'Not found');
  return table('Appointments').update(id, readAppointment(Object.assign({}, existing, ctx.body)));
});

route('DELETE', /^\/api\/appointments\/(\d+)$/, (ctx) => { table('Appointments').remove(intId(ctx.params[0])); return { ok: true }; });

// --- accounts receivable ---
route('GET', /^\/api\/receivables$/, (ctx) => {
  const t = today(ctx.query);
  const res = receivableRows(t);
  const rows = res.rows.filter((r) => r.balance > 0)
    .map((r) => Object.assign({}, r, {
      name: res.patients[r.patient_id].name,
      phone: res.patients[r.patient_id].phone,
      days_overdue: r.oldest_due ? daysBetween(r.oldest_due, t) : 0,
    }))
    .sort((a, b) => b.balance - a.balance);
  const totals = { balance: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  rows.forEach((r) => {
    totals.balance += r.balance;
    ['d0_30', 'd31_60', 'd61_90', 'd90_plus'].forEach((k) => { totals[k] += r.aging[k]; });
  });
  Object.keys(totals).forEach((k) => { totals[k] = round2(totals[k]); });
  const advances = res.rows.filter((r) => r.balance < 0)
    .map((r) => ({ patient_id: r.patient_id, name: res.patients[r.patient_id].name, credit: -r.balance }));
  return { as_of: t, totals: totals, rows: rows, advances: advances };
});

/** Writes the current dues list into a "Dues Report" tab of the spreadsheet. */
route('POST', /^\/api\/receivables\/sheet$/, (ctx) => {
  const t = today(ctx.query);
  const res = receivableRows(t);
  const rows = res.rows.filter((r) => r.balance !== 0).sort((a, b) => b.balance - a.balance);
  const header = ['Patient ID', 'Name', 'Phone', 'Billed', 'Paid', 'Balance', '0-30 days', '31-60 days', '61-90 days', '90+ days', 'Oldest due', 'Last payment'];
  const data = rows.map((r) => {
    const p = res.patients[r.patient_id];
    return [r.patient_id, writeCell('name', p.name), writeCell('phone', p.phone), r.billed, r.paid, r.balance,
      r.aging.d0_30, r.aging.d31_60, r.aging.d61_90, r.aging.d90_plus, r.oldest_due || '', r.last_payment || ''];
  });
  const sum = (i) => round2(data.reduce((s, row) => s + row[i], 0));
  let sh = ss().getSheetByName(DUES_SHEET);
  if (!sh) sh = ss().insertSheet(DUES_SHEET);
  sh.clear();
  sh.getRange(1, 1, 1, 2).setValues([['Dues as of ' + t, '']]);
  sh.getRange(1, 1, 1, 2).setFontWeight('bold');
  sh.getRange(3, 1, 1, header.length).setValues([header]);
  sh.getRange(3, 1, 1, header.length).setFontWeight('bold');
  sh.getRange(3, 1, 1, header.length).setBackground('#d9f2ef');
  if (data.length) {
    sh.getRange(4, 1, data.length, header.length).setNumberFormats(data.map(() => ['0', '@', '@', '#,##0.00', '#,##0.00', '#,##0.00', '#,##0.00', '#,##0.00', '#,##0.00', '#,##0.00', '@', '@']));
    sh.getRange(4, 1, data.length, header.length).setValues(data);
    const totalRow = ['', 'TOTAL', '', sum(3), sum(4), sum(5), sum(6), sum(7), sum(8), sum(9), '', ''];
    sh.getRange(4 + data.length, 1, 1, header.length).setValues([totalRow]);
    sh.getRange(4 + data.length, 1, 1, header.length).setFontWeight('bold');
  }
  return { url: ss().getUrl() + '#gid=' + sh.getSheetId(), rows: data.length };
});

// --- reports ---
route('GET', /^\/api\/reports$/, (ctx) => {
  const t = today(ctx.query);
  const from = date(ctx.query.from) || t.slice(0, 7) + '-01';
  const to = date(ctx.query.to) || t;
  const inRange = (d) => d && d >= from && d <= to;
  const visits = table('Visits').load().filter((v) => inRange(v.date));
  const payments = table('Payments').load().filter((p) => inRange(p.date));
  const daily = {};
  const day = (d) => { if (!daily[d]) daily[d] = { date: d, visits: 0, billed: 0, collected: 0 }; return daily[d]; };
  visits.forEach((v) => { const r = day(v.date); r.visits += 1; r.billed = round2(r.billed + (v.fee || 0)); });
  payments.forEach((p) => { const r = day(p.date); r.collected = round2(r.collected + (p.amount || 0)); });

  const methods = {};
  payments.forEach((p) => {
    if (!methods[p.method]) methods[p.method] = { method: p.method, total: 0, count: 0 };
    methods[p.method].total = round2(methods[p.method].total + p.amount);
    methods[p.method].count += 1;
  });
  const treatments = {};
  visits.filter((v) => v.treatment).forEach((v) => {
    const k = v.treatment.toLowerCase();
    if (!treatments[k]) treatments[k] = { treatment: v.treatment, count: 0, total: 0 };
    treatments[k].count += 1;
    treatments[k].total = round2(treatments[k].total + (v.fee || 0));
  });
  const values = (o) => Object.keys(o).map((k) => o[k]);
  const patientIds = {};
  visits.forEach((v) => { patientIds[v.patient_id] = true; });

  return {
    from: from,
    to: to,
    billed: round2(visits.reduce((s, v) => s + (v.fee || 0), 0)),
    collected: round2(payments.reduce((s, p) => s + (p.amount || 0), 0)),
    visits: visits.length,
    patients_seen: Object.keys(patientIds).length,
    new_patients: table('Patients').load().filter((p) => inRange(String(p.created_at || '').slice(0, 10))).length,
    by_method: values(methods).sort((a, b) => b.total - a.total),
    top_treatments: values(treatments).sort((a, b) => b.count - a.count).slice(0, 10),
    daily: values(daily).sort((a, b) => b.date.localeCompare(a.date)),
  };
});
