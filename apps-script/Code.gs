/**
 * Falguni Dental App — Google Apps Script backend.
 *
 * All data lives in the tabs of the spreadsheet this script is attached to. The web
 * page (Index.html) calls api(method, url, body, token) through google.script.run.
 *
 * Security note: google.script.run can call ANY top-level function whose name does
 * not end in "_". Everything internal therefore ends in "_"; only doGet, api, setup,
 * onOpen and dailyReminders are public, and api() checks the login on every call.
 */

const SCHEMA = {
  Patients: ['id', 'name', 'phone', 'email', 'gender', 'dob', 'age', 'address', 'medical_history', 'allergies', 'notes', 'created_at', 'updated_at'],
  // A visit is one clinical encounter. Its fee is the amount billed (a receivable).
  // New columns are only ever appended at the end so existing sheets keep working.
  Visits: ['id', 'patient_id', 'patient_name', 'date', 'complaint', 'diagnosis', 'treatment', 'teeth', 'notes', 'fee', 'next_visit', 'created_at', 'event_id', 'created_by'],
  Payments: ['id', 'patient_id', 'patient_name', 'date', 'amount', 'method', 'note', 'created_at', 'event_id', 'created_by'],
  Appointments: ['id', 'patient_id', 'patient_name', 'date', 'time', 'purpose', 'status', 'created_at', 'calendar_event_id', 'patient_reminded', 'created_by'],
  // Events are things like dental camps or corporate check-up drives, tracked for profitability.
  Events: ['id', 'name', 'type', 'date', 'end_date', 'location', 'notes', 'created_at'],
  Expenses: ['id', 'date', 'category', 'description', 'amount', 'method', 'paid_to', 'event_id', 'event_name', 'created_by', 'created_at'],
  // Income other than patient payments (sponsorships, camp fees paid by an organiser, ...).
  Income: ['id', 'date', 'category', 'description', 'amount', 'method', 'received_from', 'event_id', 'event_name', 'created_by', 'created_at'],
  Settings: ['key', 'value'],
};
const NUMBER_FORMATS = { id: '0', patient_id: '0', event_id: '0', age: '0', fee: '#,##0.00', amount: '#,##0.00' };
const DATETIME_COLS = { created_at: true, updated_at: true };

const ROLES = ['doctor', 'compounder'];
const ROLE_LABEL = { doctor: 'Doctor', compounder: 'Compounder' };
const PAYMENT_METHODS = ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Cheque', 'Other'];
const APPT_STATUSES = ['scheduled', 'done', 'cancelled', 'no-show'];
const EVENT_TYPES = ['Dental camp', 'School camp', 'Corporate check-up', 'Workshop / CDE', 'Promotion', 'Other'];
const EXPENSE_CATEGORIES = ['Rent', 'Salary', 'Dental materials', 'Lab charges', 'Medicines', 'Equipment', 'Electricity / Utilities', 'Travel', 'Food / Refreshments', 'Printing / Marketing', 'Maintenance', 'Other'];
const INCOME_CATEGORIES = ['Sponsorship', 'Camp fee (organiser)', 'Product sales', 'Other'];

const SETTING_KEYS = [
  'clinic_name', 'doctor_name', 'clinic_phone', 'clinic_address', 'currency', 'country_code', 'reminder_template',
  'doctor_email', 'compounder_email', 'calendar_sync', 'reminder_minutes', 'appt_duration',
  'daily_digest', 'patient_email_reminders',
];
const DEFAULT_SETTINGS = {
  clinic_name: 'Falguni Dental Clinic',
  doctor_name: '',
  clinic_phone: '',
  clinic_address: '',
  currency: '₹',
  country_code: '91',
  reminder_template:
    'Hello {name}, this is a gentle reminder from {clinic} that an amount of {amount} is pending for your dental treatment. Thank you!',
  doctor_email: '',
  compounder_email: '',
  calendar_sync: 'yes',
  reminder_minutes: '30',
  appt_duration: '30',
  daily_digest: 'yes',
  patient_email_reminders: 'yes',
  // Internal (not editable from the app):
  calendar_id: '',
  last_digest: '',
};
const DUES_SHEET = 'Dues Report';
const SESSION_DAYS = 30;
const CALENDAR_NAME = 'Clinic Appointments';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ======================================================================
   Public entry points
   ====================================================================== */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(getSettings_().clinic_name || 'Dental Clinic')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/**
 * Run once from the Apps Script editor: creates the tabs, the clinic calendar and the
 * daily 7 am reminder job, and makes Google ask for all permissions. Safe to run again.
 */
function setup() {
  ensureSheets_();
  installDailyTrigger_();
  const s = getSettings_();
  let cal = 'off';
  if (s.calendar_sync === 'yes') {
    try {
      cal = clinicCalendar_().getName();
    } catch (e) {
      cal = 'not available (' + e.message + ')';
    }
  }
  return 'Ready. Tabs: ' + Object.keys(SCHEMA).join(', ') + '. Calendar: ' + cal + '. Daily reminders: 7 am.';
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🦷 Dental App')
    .addItem('Set up / repair', 'setup')
    .addToUi();
}

/**
 * The single API used by the web page. Returns a JSON string:
 * { ok: true, data } on success, { ok: false, status, error } on failure.
 */
function api(method, url, body, token) {
  let lock = null;
  try {
    if (method !== 'GET') {
      lock = LockService.getScriptLock();
      lock.waitLock(30000);
    }
    ensureSheets_(!!lock);
    tableCache = {};
    settingsCache = null;
    const req = parseUrl_(url);
    for (let i = 0; i < ROUTES.length; i++) {
      const r = ROUTES[i];
      if (r.method !== method) continue;
      const m = r.pattern.exec(req.path);
      if (!m) continue;
      const user = r.roles ? sessionUser_(token) : null;
      if (r.roles && r.roles.indexOf(user.role) < 0) throw new HttpError(403, 'Only the doctor can do this.');
      const data = r.handler({ body: body || {}, query: req.query, params: m.slice(1), user: user, token: token });
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

/**
 * Runs every morning (time trigger set up by setup()): emails today's appointment list
 * to the doctor and compounder, and emails tomorrow's patients who have an email address.
 * It only ever runs once per day, so calling it again does nothing.
 */
function dailyReminders() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ensureSheets_(true);
    tableCache = {};
    settingsCache = null;
    const today = localToday_();
    if (getSettings_().last_digest === today) return 'Already sent today';
    setSetting_('last_digest', today);
    return sendStaffDigest_(today) + ' ' + sendPatientReminders_(addDays_(today, 1));
  } finally {
    lock.releaseLock();
  }
}

/* ======================================================================
   Spreadsheet storage
   ====================================================================== */

let spreadsheet = null;
let sheetsReady = false;
let tableCache = {};
let settingsCache = null;

function ss_() {
  if (!spreadsheet) spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  return spreadsheet;
}

function timeZone_() {
  return ss_().getSpreadsheetTimeZone() || Session.getScriptTimeZone();
}

function formatFor_(col) {
  return NUMBER_FORMATS[col] || '@';
}

function ensureSheets_(haveLock) {
  if (sheetsReady) return;
  const needsWork = () => Object.keys(SCHEMA).some((name) => {
    const sh = ss_().getSheetByName(name);
    if (!sh || sh.getLastRow() === 0) return true;
    const header = sh.getRange(1, 1, 1, SCHEMA[name].length).getValues()[0];
    return SCHEMA[name].some((c, i) => header[i] !== c);
  }) || settingsMissing_().length > 0;
  if (needsWork()) {
    let lock = null;
    if (!haveLock) {
      lock = LockService.getScriptLock();
      lock.waitLock(30000);
    }
    try {
      Object.keys(SCHEMA).forEach((name) => {
        let sh = ss_().getSheetByName(name);
        if (!sh) sh = ss_().insertSheet(name);
        const cols = SCHEMA[name];
        const header = sh.getRange(1, 1, 1, cols.length).getValues()[0];
        cols.forEach((c, i) => {
          if (header[i] === c) return;
          if (header[i] !== '' && header[i] !== null) {
            throw new Error('The "' + name + '" tab has an unexpected column "' + header[i] + '" where "' + c + '" should be. Please undo the change to the header row.');
          }
          // New (or newly added) column: write its header and pre-format it so Sheets doesn't
          // turn dates, times or phone numbers into something else.
          sh.getRange(1, i + 1).setValue(c);
          const rows = Math.max(sh.getMaxRows() - 1, 1);
          sh.getRange(2, i + 1, rows, 1).setNumberFormat(formatFor_(c));
        });
        const head = sh.getRange(1, 1, 1, cols.length);
        head.setFontWeight('bold');
        head.setBackground('#d9f2ef');
        sh.setFrozenRows(1);
      });
      const settings = new Table_('Settings');
      settingsMissing_().forEach((k) => settings.insert({ key: k, value: DEFAULT_SETTINGS[k] }));
    } finally {
      if (lock) lock.releaseLock();
    }
  }
  sheetsReady = true;
}

function settingsMissing_() {
  const sh = ss_().getSheetByName('Settings');
  if (!sh || sh.getLastRow() === 0) return Object.keys(DEFAULT_SETTINGS);
  const have = {};
  new Table_('Settings').load().forEach((r) => { have[r.key] = true; });
  return Object.keys(DEFAULT_SETTINGS).filter((k) => !have[k]);
}

function readCell_(col, v, tz) {
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

function writeCell_(col, v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return v;
  const s = String(v);
  // A leading apostrophe keeps text like "+91 98..." or "=..." from being read as a formula.
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function nowStamp_() {
  return Utilities.formatDate(new Date(), timeZone_(), 'yyyy-MM-dd HH:mm:ss');
}

class Table_ {
  constructor(name) {
    this.name = name;
    this.cols = SCHEMA[name];
    this.sheet = ss_().getSheetByName(name);
    this.rows = null;
  }

  load() {
    if (this.rows) return this.rows;
    const last = this.sheet.getLastRow();
    const values = last > 1 ? this.sheet.getRange(2, 1, last - 1, this.cols.length).getValues() : [];
    const tz = timeZone_();
    this.rows = [];
    values.forEach((v, i) => {
      if (v.every((x) => x === '' || x === null)) return;
      const o = {};
      this.cols.forEach((c, j) => { o[c] = readCell_(c, v[j], tz); });
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
    range.setNumberFormats([this.cols.map(formatFor_)]);
    range.setValues([this.cols.map((c) => writeCell_(c, obj[c]))]);
  }

  insert(data) {
    const rows = this.load();
    const obj = {};
    this.cols.forEach((c) => { obj[c] = data[c] === undefined ? null : data[c]; });
    if (this.cols.indexOf('id') >= 0) obj.id = rows.reduce((m, r) => Math.max(m, r.id || 0), 0) + 1;
    if (this.cols.indexOf('created_at') >= 0) obj.created_at = nowStamp_();
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
    if (this.cols.indexOf('updated_at') >= 0) row.updated_at = nowStamp_();
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

function table_(name) {
  if (!tableCache[name]) tableCache[name] = new Table_(name);
  return tableCache[name];
}

function getSettings_() {
  ensureSheets_();
  if (settingsCache) return settingsCache;
  const out = {};
  Object.keys(DEFAULT_SETTINGS).forEach((k) => { out[k] = DEFAULT_SETTINGS[k]; });
  table_('Settings').load().forEach((r) => {
    if (r.key in DEFAULT_SETTINGS) out[r.key] = r.value === null ? '' : r.value;
  });
  settingsCache = out;
  return out;
}

function publicSettings_(user) {
  const s = getSettings_();
  const out = {};
  SETTING_KEYS.forEach((k) => { out[k] = s[k]; });
  if (user && user.role === 'doctor') out.spreadsheet_url = ss_().getUrl();
  return out;
}

function setSetting_(key, value) {
  const t = table_('Settings');
  const row = t.load().find((r) => r.key === key);
  if (row) {
    row.value = value;
    t.writeRow(row._row, row);
  } else {
    t.insert({ key: key, value: value });
  }
  settingsCache = null;
}

/* ======================================================================
   Logins (doctor / compounder)
   ====================================================================== */

function props_() {
  return PropertiesService.getScriptProperties();
}

function bytesToHex_(bytes) {
  return bytes.map((b) => ((b < 0 ? b + 256 : b).toString(16)).padStart(2, '0')).join('');
}

function hashPassword_(password, salt) {
  let h = salt + ':' + password;
  for (let i = 0; i < 200; i++) h = bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt));
  return h;
}

function newToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function setPassword_(role, password) {
  if (ROLES.indexOf(role) < 0) throw new HttpError(400, 'Unknown login');
  if (String(password || '').length < 4) throw new HttpError(400, ROLE_LABEL[role] + ' password must be at least 4 characters');
  const salt = newToken_().slice(0, 16);
  props_().setProperty('pw:' + role, salt + ':' + hashPassword_(String(password), salt));
}

function checkPassword_(role, password) {
  const stored = props_().getProperty('pw:' + role);
  if (!stored) return false;
  const i = stored.indexOf(':');
  return hashPassword_(String(password || ''), stored.slice(0, i)) === stored.slice(i + 1);
}

function isSetUp_() {
  return !!props_().getProperty('pw:doctor');
}

function startSession_(role) {
  const p = props_();
  const now = Date.now();
  // Drop expired sessions so the property store doesn't grow forever.
  p.getKeys().filter((k) => k.indexOf('sess:') === 0).forEach((k) => {
    try {
      if (JSON.parse(p.getProperty(k)).exp < now) p.deleteProperty(k);
    } catch (e) {
      p.deleteProperty(k);
    }
  });
  const token = newToken_();
  p.setProperty('sess:' + token, JSON.stringify({ role: role, exp: now + SESSION_DAYS * 86400000 }));
  return token;
}

function sessionUser_(token) {
  if (!token || !/^[0-9a-f]{64}$/i.test(token)) throw new HttpError(401, 'Please log in');
  const p = props_();
  const raw = p.getProperty('sess:' + token);
  if (!raw) throw new HttpError(401, 'Please log in');
  const s = JSON.parse(raw);
  const now = Date.now();
  if (s.exp < now) {
    p.deleteProperty('sess:' + token);
    throw new HttpError(401, 'Your login expired. Please log in again.');
  }
  // Sliding expiry, refreshed at most about once a day.
  if (s.exp - now < (SESSION_DAYS - 1) * 86400000) {
    s.exp = now + SESSION_DAYS * 86400000;
    p.setProperty('sess:' + token, JSON.stringify(s));
  }
  return { role: s.role };
}

function endSessionsFor_(role, exceptToken) {
  const p = props_();
  p.getKeys().filter((k) => k.indexOf('sess:') === 0 && k !== 'sess:' + exceptToken).forEach((k) => {
    try {
      if (JSON.parse(p.getProperty(k)).role === role) p.deleteProperty(k);
    } catch (e) {
      p.deleteProperty(k);
    }
  });
}

/* ======================================================================
   Validation helpers
   ====================================================================== */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function str_(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max || 2000) : null;
}

function date_(v, opts) {
  opts = opts || {};
  const field = opts.field || 'date';
  const s = str_(v, 10);
  if (!s) {
    if (opts.required) throw new HttpError(400, field + ' is required');
    return null;
  }
  if (!DATE_RE.test(s) || isNaN(Date.parse(s))) throw new HttpError(400, field + ' must be YYYY-MM-DD');
  return s;
}

function money_(v, opts) {
  opts = opts || {};
  const field = opts.field || 'amount';
  const allowZero = opts.allowZero !== false;
  if (v === undefined || v === null || v === '') {
    if (allowZero) return 0;
    throw new HttpError(400, field + ' is required');
  }
  const n = Number(v);
  if (!isFinite(n) || n < 0 || (!allowZero && n === 0)) throw new HttpError(400, field + ' must be a positive number');
  return round2_(n);
}

function oneOf_(v, list, fallback) {
  const s = str_(v, 60);
  return s && list.indexOf(s) >= 0 ? s : fallback;
}

function round2_(n) {
  return Math.round(n * 100) / 100;
}

function intId_(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'invalid id');
  return n;
}

function localToday_() {
  return Utilities.formatDate(new Date(), timeZone_(), 'yyyy-MM-dd');
}

function today_(query) {
  try {
    return date_(query.today) || localToday_();
  } catch (e) {
    return localToday_();
  }
}

function addDays_(s, n) {
  return new Date(Date.parse(s) + n * 86400000).toISOString().slice(0, 10);
}

function daysBetween_(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

function parseUrl_(url) {
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

function byDateDesc_(a, b) {
  return String(b.date).localeCompare(String(a.date)) || b.id - a.id;
}

function byTime_(a, b) {
  return String(a.date).localeCompare(String(b.date)) ||
    (a.time ? 0 : 1) - (b.time ? 0 : 1) ||
    String(a.time || '').localeCompare(String(b.time || '')) || a.id - b.id;
}

function sum_(list, field) {
  return round2_(list.reduce((s, x) => s + (x[field] || 0), 0));
}

function esc_(v) {
  return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/* ======================================================================
   Domain logic
   ====================================================================== */

function emptyAccount_(patientId) {
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
function receivables_(asOf, patientId) {
  const map = {};
  const get = (id) => {
    if (!map[id]) {
      map[id] = emptyAccount_(id);
      map[id].charges = [];
    }
    return map[id];
  };
  table_('Visits').load()
    .filter((v) => v.fee > 0 && (!patientId || v.patient_id === patientId))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.id - b.id)
    .forEach((v) => {
      const r = get(v.patient_id);
      r.billed += v.fee;
      r.charges.push(v);
    });
  table_('Payments').load()
    .filter((p) => !patientId || p.patient_id === patientId)
    .forEach((p) => {
      const r = get(p.patient_id);
      r.paid += p.amount || 0;
      if (!r.last_payment || p.date > r.last_payment) r.last_payment = p.date;
    });
  Object.keys(map).forEach((k) => {
    const r = map[k];
    r.billed = round2_(r.billed);
    r.paid = round2_(r.paid);
    r.balance = round2_(r.billed - r.paid);
    let credit = r.paid;
    r.charges.forEach((c) => {
      const applied = Math.min(credit, c.fee);
      credit -= applied;
      const open = round2_(c.fee - applied);
      if (open <= 0) return;
      if (!r.oldest_due) r.oldest_due = c.date;
      const age = daysBetween_(c.date, asOf);
      const bucket = age <= 30 ? 'd0_30' : age <= 60 ? 'd31_60' : age <= 90 ? 'd61_90' : 'd90_plus';
      r.aging[bucket] = round2_(r.aging[bucket] + open);
    });
    delete r.charges;
  });
  return map;
}

function balanceFor_(patientId, asOf) {
  return receivables_(asOf, patientId)[patientId] || emptyAccount_(patientId);
}

function requirePatient_(id) {
  const p = table_('Patients').get(id);
  if (!p) throw new HttpError(404, 'Patient not found');
  return p;
}

function eventRef_(v) {
  if (v === undefined || v === null || v === '' || v === 0 || v === '0') return null;
  const ev = table_('Events').get(intId_(v));
  if (!ev) throw new HttpError(400, 'That event no longer exists');
  return ev;
}

function readPatient_(body) {
  const name = str_(body.name, 200);
  if (!name) throw new HttpError(400, 'Patient name is required');
  let age = null;
  if (body.age !== undefined && body.age !== null && body.age !== '') {
    age = Number(body.age);
    if (!Number.isInteger(age) || age < 0 || age > 130) throw new HttpError(400, 'Age must be a whole number');
  }
  return {
    name: name,
    phone: str_(body.phone, 30),
    email: str_(body.email, 200),
    gender: str_(body.gender, 20),
    dob: date_(body.dob, { field: 'Date of birth' }),
    age: age,
    address: str_(body.address, 500),
    medical_history: str_(body.medical_history),
    allergies: str_(body.allergies, 500),
    notes: str_(body.notes),
  };
}

function readVisit_(body) {
  const ev = eventRef_(body.event_id);
  return {
    date: date_(body.date, { required: true }),
    complaint: str_(body.complaint),
    diagnosis: str_(body.diagnosis),
    treatment: str_(body.treatment),
    teeth: str_(body.teeth, 300),
    notes: str_(body.notes),
    fee: money_(body.fee, { field: 'Fee' }),
    next_visit: date_(body.next_visit, { field: 'Next visit' }),
    event_id: ev ? ev.id : null,
  };
}

function readPayment_(body) {
  const ev = eventRef_(body.event_id);
  return {
    date: date_(body.date, { required: true }),
    amount: money_(body.amount, { field: 'Amount', allowZero: false }),
    method: oneOf_(body.method, PAYMENT_METHODS, 'Other'),
    note: str_(body.note, 500),
    event_id: ev ? ev.id : null,
  };
}

function readAppointment_(body) {
  const status = str_(body.status, 20) || 'scheduled';
  const time = str_(body.time, 5);
  if (time && !TIME_RE.test(time)) throw new HttpError(400, 'time must be HH:MM');
  if (APPT_STATUSES.indexOf(status) < 0) throw new HttpError(400, 'invalid status');
  return { date: date_(body.date, { required: true }), time: time, purpose: str_(body.purpose, 300), status: status };
}

function readEvent_(body) {
  const name = str_(body.name, 200);
  if (!name) throw new HttpError(400, 'Event name is required');
  const start = date_(body.date, { required: true });
  const end = date_(body.end_date, { field: 'End date' });
  if (end && end < start) throw new HttpError(400, 'End date is before the start date');
  return {
    name: name,
    type: oneOf_(body.type, EVENT_TYPES, 'Other'),
    date: start,
    end_date: end,
    location: str_(body.location, 300),
    notes: str_(body.notes),
  };
}

function readLedger_(body, categories, partyField) {
  const ev = eventRef_(body.event_id);
  const out = {
    date: date_(body.date, { required: true }),
    category: oneOf_(body.category, categories, 'Other'),
    description: str_(body.description, 500),
    amount: money_(body.amount, { field: 'Amount', allowZero: false }),
    method: oneOf_(body.method, PAYMENT_METHODS, 'Cash'),
    event_id: ev ? ev.id : null,
    event_name: ev ? ev.name : null,
  };
  out[partyField] = str_(body[partyField], 200);
  return out;
}

function patientsById_() {
  const out = {};
  table_('Patients').load().forEach((p) => { out[p.id] = p; });
  return out;
}

function withPatient_(rows) {
  const patients = patientsById_();
  return rows
    .filter((r) => patients[r.patient_id])
    .map((r) => Object.assign({}, r, { patient_name: patients[r.patient_id].name, patient_phone: patients[r.patient_id].phone }));
}

function receivableRows_(t) {
  const ar = receivables_(t);
  const patients = patientsById_();
  const rows = Object.keys(ar).map((k) => ar[k]).filter((r) => patients[r.patient_id]);
  return { rows: rows, patients: patients };
}

/** Income, expenses and profit for one event (all time). */
function eventSummary_(ev) {
  const id = ev.id;
  const visits = table_('Visits').load().filter((v) => v.event_id === id);
  const payments = table_('Payments').load().filter((p) => p.event_id === id);
  const income = table_('Income').load().filter((x) => x.event_id === id);
  const expenses = table_('Expenses').load().filter((x) => x.event_id === id);
  const patientIncome = sum_(payments, 'amount');
  const otherIncome = sum_(income, 'amount');
  const totalIncome = round2_(patientIncome + otherIncome);
  const totalExpenses = sum_(expenses, 'amount');
  const profit = round2_(totalIncome - totalExpenses);
  const seen = {};
  visits.forEach((v) => { seen[v.patient_id] = true; });
  return Object.assign({}, ev, {
    patients_seen: Object.keys(seen).length,
    visits: visits.length,
    billed: sum_(visits, 'fee'),
    patient_income: patientIncome,
    other_income: otherIncome,
    income: totalIncome,
    expenses: totalExpenses,
    profit: profit,
    margin: totalIncome > 0 ? Math.round((profit / totalIncome) * 1000) / 10 : null,
  });
}

function categoryTotals_(rows) {
  const out = {};
  rows.forEach((r) => { out[r.category] = round2_((out[r.category] || 0) + r.amount); });
  return Object.keys(out).map((k) => ({ category: k, total: out[k] })).sort((a, b) => b.total - a.total);
}

/* ---------- Google Calendar & reminders ---------- */

function clinicCalendar_() {
  const s = getSettings_();
  let cal = s.calendar_id ? CalendarApp.getCalendarById(s.calendar_id) : null;
  if (!cal) {
    cal = CalendarApp.createCalendar(CALENDAR_NAME, { timeZone: timeZone_(), color: CalendarApp.Color.TEAL });
    setSetting_('calendar_id', cal.getId());
  }
  return cal;
}

function staffEmails_() {
  const s = getSettings_();
  const out = [];
  [s.doctor_email, s.compounder_email].forEach((e) => {
    const v = str_(e, 200);
    if (v && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) && out.indexOf(v.toLowerCase()) < 0) out.push(v.toLowerCase());
  });
  return out;
}

function waLink_(phone, text) {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 11 && d.charAt(0) === '0') d = d.slice(1);
  if (d.length === 10) d = (getSettings_().country_code || '91') + d;
  return 'https://wa.me/' + d + '?text=' + encodeURIComponent(text);
}

function apptMessage_(a, patientName) {
  const s = getSettings_();
  const when = Utilities.formatDate(Utilities.parseDate(a.date, timeZone_(), 'yyyy-MM-dd'), timeZone_(), 'EEE d MMM') +
    (a.time ? ' at ' + a.time : '');
  return 'Hello ' + patientName + ', this is a reminder of your dental appointment at ' + (s.clinic_name || 'our clinic') +
    ' on ' + when + '. Please reply to confirm.';
}

/**
 * Mirrors one appointment into the clinic's Google Calendar (with a pop-up reminder),
 * so the doctor's and compounder's phones get notified. Never fails the save itself.
 */
function syncCalendar_(appt, patient) {
  const s = getSettings_();
  if (s.calendar_sync !== 'yes') return appt.calendar_event_id || null;
  try {
    const cal = clinicCalendar_();
    if (appt.calendar_event_id) {
      const old = cal.getEventById(appt.calendar_event_id);
      if (old) old.deleteEvent();
    }
    if (appt.status !== 'scheduled' || !patient) return null;
    const tz = timeZone_();
    const owner = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
    const guests = staffEmails_().filter((e) => e !== owner).join(',');
    const wa = patient.phone ? waLink_(patient.phone, apptMessage_(appt, patient.name)) : null;
    const opts = {
      description: [
        'Patient: ' + patient.name + ' (P-' + String(patient.id).padStart(4, '0') + ')',
        patient.phone ? 'Phone: ' + patient.phone : '',
        appt.purpose ? 'Purpose: ' + appt.purpose : '',
        wa ? 'Send WhatsApp reminder: ' + wa : '',
      ].filter(Boolean).join('\n'),
      sendInvites: false,
    };
    if (guests) opts.guests = guests;
    const title = '🦷 ' + patient.name + (appt.purpose ? ' – ' + appt.purpose : '');
    const minutes = Math.max(0, Math.min(40320, Number(s.reminder_minutes) || 30));
    let ev;
    if (appt.time) {
      const start = Utilities.parseDate(appt.date + ' ' + appt.time, tz, 'yyyy-MM-dd HH:mm');
      const end = new Date(start.getTime() + Math.max(5, Number(s.appt_duration) || 30) * 60000);
      ev = cal.createEvent(title, start, end, opts);
      ev.removeAllReminders();
      ev.addPopupReminder(minutes);
    } else {
      ev = cal.createAllDayEvent(title, Utilities.parseDate(appt.date, tz, 'yyyy-MM-dd'), opts);
      ev.removeAllReminders();
      ev.addPopupReminder(15 * 60); // counted back from midnight: 9 am the day before
    }
    return ev.getId();
  } catch (e) {
    console.error('Calendar sync failed: ' + (e && e.message));
    return appt.calendar_event_id || null;
  }
}

function removeFromCalendar_(appt) {
  if (!appt.calendar_event_id) return;
  try {
    const ev = clinicCalendar_().getEventById(appt.calendar_event_id);
    if (ev) ev.deleteEvent();
  } catch (e) {
    console.error('Calendar delete failed: ' + (e && e.message));
  }
}

function installDailyTrigger_() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'dailyReminders')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyReminders').timeBased().everyDays(1).atHour(7).inTimezone(timeZone_()).create();
}

function sendStaffDigest_(today, force) {
  const s = getSettings_();
  const to = staffEmails_();
  if ((s.daily_digest !== 'yes' && !force) || !to.length) return 'Staff digest: off.';
  const patients = patientsById_();
  const appts = table_('Appointments').load()
    .filter((a) => a.date === today && a.status === 'scheduled' && patients[a.patient_id])
    .sort(byTime_);
  const rows = appts.map((a) => {
    const p = patients[a.patient_id];
    const wa = p.phone ? waLink_(p.phone, apptMessage_(a, p.name)) : null;
    return '<tr><td style="padding:6px 10px 6px 0"><b>' + esc_(a.time || '—') + '</b></td><td style="padding:6px 10px 6px 0">' +
      esc_(p.name) + (a.purpose ? '<br><span style="color:#5d707a">' + esc_(a.purpose) + '</span>' : '') +
      '</td><td style="padding:6px 0">' + (wa ? '<a href="' + esc_(wa) + '">WhatsApp reminder</a>' : '') +
      (p.phone ? '<br><a href="tel:' + esc_(p.phone) + '">' + esc_(p.phone) + '</a>' : '') + '</td></tr>';
  }).join('');
  const html = '<div style="font-family:Arial,sans-serif;font-size:15px">' +
    '<h2 style="color:#0f766e;margin:0 0 6px">' + esc_(s.clinic_name) + '</h2>' +
    '<p style="margin:0 0 14px">Today: <b>' + appts.length + ' appointment' + (appts.length === 1 ? '' : 's') + '</b></p>' +
    (appts.length ? '<table style="border-collapse:collapse">' + rows + '</table>' : '<p>No appointments booked for today.</p>') +
    '<p style="color:#5d707a;font-size:13px;margin-top:18px">Tap “WhatsApp reminder” to send the patient a ready-made message.</p></div>';
  MailApp.sendEmail({
    to: to.join(','),
    subject: '🦷 Today: ' + appts.length + ' appointment' + (appts.length === 1 ? '' : 's') + ' – ' + s.clinic_name,
    htmlBody: html,
    name: s.clinic_name,
  });
  return 'Staff digest sent to ' + to.length + '.';
}

function sendPatientReminders_(day) {
  const s = getSettings_();
  if (s.patient_email_reminders !== 'yes') return 'Patient emails: off.';
  const patients = patientsById_();
  const t = table_('Appointments');
  let sent = 0;
  t.load().filter((a) => a.date === day && a.status === 'scheduled' && !a.patient_reminded).forEach((a) => {
    const p = patients[a.patient_id];
    if (!p || !p.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) return;
    if (MailApp.getRemainingDailyQuota() < 5) return;
    MailApp.sendEmail({
      to: p.email,
      subject: 'Appointment reminder – ' + s.clinic_name,
      body: apptMessage_(a, p.name) + (s.clinic_phone ? '\n\nClinic phone: ' + s.clinic_phone : '') +
        (s.clinic_address ? '\n' + s.clinic_address : ''),
      name: s.clinic_name,
    });
    a.patient_reminded = localToday_();
    t.writeRow(a._row, a);
    sent++;
  });
  return 'Patient emails sent: ' + sent + '.';
}

/* ======================================================================
   Routes
   ====================================================================== */

const ROUTES = [];
const ANYONE = null; // no login needed
const STAFF = ['doctor', 'compounder'];
const DOCTOR = ['doctor'];

function route_(method, pattern, roles, handler) {
  ROUTES.push({ method: method, pattern: pattern, roles: roles, handler: handler });
}

// --- logins ---
route_('GET', /^\/api\/status$/, ANYONE, () => {
  const s = getSettings_();
  return { setup_required: !isSetUp_(), clinic_name: s.clinic_name, doctor_name: s.doctor_name };
});

route_('POST', /^\/api\/setup$/, ANYONE, (ctx) => {
  if (isSetUp_()) throw new HttpError(409, 'Already set up');
  const b = ctx.body;
  if (b.doctor_password === b.compounder_password) throw new HttpError(400, 'Use different passwords for the doctor and the compounder');
  setPassword_('compounder', b.compounder_password);
  setPassword_('doctor', b.doctor_password);
  ['clinic_name', 'doctor_name', 'clinic_phone', 'doctor_email', 'compounder_email'].forEach((k) => {
    const v = str_(b[k], 300);
    if (v) setSetting_(k, v);
  });
  return { token: startSession_('doctor'), role: 'doctor' };
});

route_('POST', /^\/api\/login$/, ANYONE, (ctx) => {
  const role = oneOf_(ctx.body.role, ROLES, null);
  if (!role) throw new HttpError(400, 'Choose Doctor or Compounder');
  const cache = CacheService.getScriptCache();
  const key = 'fails:' + role;
  const fails = Number(cache.get(key) || 0);
  if (fails >= 5) throw new HttpError(429, 'Too many wrong attempts. Please wait 5 minutes.');
  if (!checkPassword_(role, ctx.body.password)) {
    cache.put(key, String(fails + 1), 300);
    throw new HttpError(401, 'Wrong password');
  }
  cache.remove(key);
  return { token: startSession_(role), role: role };
});

route_('POST', /^\/api\/logout$/, STAFF, (ctx) => {
  props_().deleteProperty('sess:' + ctx.token);
  return { ok: true };
});

route_('GET', /^\/api\/me$/, STAFF, (ctx) => ({ role: ctx.user.role, settings: publicSettings_(ctx.user) }));

route_('POST', /^\/api\/passwords$/, DOCTOR, (ctx) => {
  const role = oneOf_(ctx.body.role, ROLES, null);
  if (!role) throw new HttpError(400, 'Choose whose password to change');
  if (!checkPassword_('doctor', ctx.body.current)) throw new HttpError(400, 'Your current (doctor) password is wrong');
  setPassword_(role, ctx.body.password);
  endSessionsFor_(role, ctx.token); // log that person out everywhere else
  return { ok: true };
});

// --- settings ---
route_('PUT', /^\/api\/settings$/, DOCTOR, (ctx) => {
  SETTING_KEYS.forEach((key) => {
    if (key in ctx.body) {
      const v = str_(ctx.body[key], 1000);
      setSetting_(key, v === null ? '' : v);
    }
  });
  return publicSettings_(ctx.user);
});

route_('GET', /^\/api\/reminders\/status$/, DOCTOR, () => {
  const s = getSettings_();
  const trigger = ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'dailyReminders');
  let calendar = null;
  if (s.calendar_sync === 'yes' && s.calendar_id) {
    try {
      const c = CalendarApp.getCalendarById(s.calendar_id);
      calendar = c ? c.getName() : null;
    } catch (e) {
      calendar = null;
    }
  }
  return { daily_trigger: trigger, calendar: calendar, staff_emails: staffEmails_(), email_quota: MailApp.getRemainingDailyQuota() };
});

route_('POST', /^\/api\/reminders\/test$/, DOCTOR, (ctx) => {
  if (!staffEmails_().length) throw new HttpError(400, 'Add the doctor’s or compounder’s email in Settings first');
  return { message: sendStaffDigest_(today_(ctx.query), true) };
});

// --- dashboard ---
route_('GET', /^\/api\/dashboard$/, STAFF, (ctx) => {
  const t = today_(ctx.query);
  const month = t.slice(0, 7);
  const isDoctor = ctx.user.role === 'doctor';
  const patients = table_('Patients').load();
  const visits = table_('Visits').load();
  const payments = table_('Payments').load();
  const appts = table_('Appointments').load();
  const ar = receivables_(t);
  const known = patientsById_();
  const arRows = Object.keys(ar).map((k) => ar[k]).filter((r) => known[r.patient_id]);

  // Follow-ups: the latest visit asked for a next visit within 7 days and nothing is booked yet.
  const latest = {};
  visits.forEach((v) => {
    const cur = latest[v.patient_id];
    if (!cur || v.date > cur.date || (v.date === cur.date && v.id > cur.id)) latest[v.patient_id] = v;
  });
  const weekEnd = addDays_(t, 7);
  const followups = withPatient_(Object.keys(latest).map((k) => latest[k])
    .filter((v) => v.next_visit && v.next_visit >= t && v.next_visit <= weekEnd)
    .filter((v) => !appts.some((a) => a.patient_id === v.patient_id && a.date >= t && a.status === 'scheduled')))
    .sort((a, b) => a.next_visit.localeCompare(b.next_visit))
    .slice(0, 20)
    .map((v) => ({ id: v.id, patient_id: v.patient_id, next_visit: v.next_visit, treatment: v.treatment, patient_name: v.patient_name, patient_phone: v.patient_phone }));

  const out = {
    today: t,
    role: ctx.user.role,
    patients: patients.length,
    collected_today: sum_(payments.filter((p) => p.date === t), 'amount'),
    visits_today: visits.filter((v) => v.date === t).length,
    outstanding: round2_(arRows.reduce((s, r) => s + Math.max(r.balance, 0), 0)),
    patients_with_dues: arRows.filter((r) => r.balance > 0).length,
    appointments_today: withPatient_(appts.filter((a) => a.date === t)).sort(byTime_),
    appointments_tomorrow: appts.filter((a) => a.date === addDays_(t, 1) && a.status === 'scheduled').length,
    followups: followups,
    recent_visits: withPatient_(visits.slice().sort(byDateDesc_).slice(0, 5))
      .map((v) => ({ id: v.id, patient_id: v.patient_id, date: v.date, treatment: v.treatment, fee: v.fee, patient_name: v.patient_name })),
  };
  if (isDoctor) {
    const inMonth = (r) => String(r.date).slice(0, 7) === month;
    const income = round2_(sum_(payments.filter(inMonth), 'amount') + sum_(table_('Income').load().filter(inMonth), 'amount'));
    const expenses = sum_(table_('Expenses').load().filter(inMonth), 'amount');
    out.collected_month = sum_(payments.filter(inMonth), 'amount');
    out.month_income = income;
    out.month_expenses = expenses;
    out.month_profit = round2_(income - expenses);
  }
  return out;
});

// --- patients ---
route_('GET', /^\/api\/patients$/, STAFF, (ctx) => {
  const q = str_(ctx.query.q, 100);
  const t = today_(ctx.query);
  const lastVisit = {};
  table_('Visits').load().forEach((v) => { if (!lastVisit[v.patient_id] || v.date > lastVisit[v.patient_id]) lastVisit[v.patient_id] = v.date; });
  let rows = table_('Patients').all();
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
  const ar = receivables_(t);
  rows = rows.map((p) => Object.assign({}, p, { balance: ar[p.id] ? ar[p.id].balance : 0, last_visit: lastVisit[p.id] || null }));
  if (ctx.query.filter === 'due') rows = rows.filter((p) => p.balance > 0);
  return rows;
});

route_('POST', /^\/api\/patients$/, STAFF, (ctx) => table_('Patients').insert(readPatient_(ctx.body)));

route_('GET', /^\/api\/patients\/(\d+)$/, STAFF, (ctx) => {
  const id = intId_(ctx.params[0]);
  const patient = requirePatient_(id);
  const mine = (name) => table_(name).load().filter((r) => r.patient_id === id);
  const events = {};
  table_('Events').load().forEach((e) => { events[e.id] = e.name; });
  const tagEvent = (r) => Object.assign({}, r, { event_name: r.event_id ? events[r.event_id] || null : null });
  return {
    patient: patient,
    account: balanceFor_(id, today_(ctx.query)),
    visits: mine('Visits').sort(byDateDesc_).map(tagEvent),
    payments: mine('Payments').sort(byDateDesc_).map(tagEvent),
    appointments: mine('Appointments').sort((a, b) => byTime_(b, a)),
  };
});

route_('PUT', /^\/api\/patients\/(\d+)$/, STAFF, (ctx) => {
  const id = intId_(ctx.params[0]);
  const before = requirePatient_(id).name;
  const p = table_('Patients').update(id, readPatient_(ctx.body));
  if (p.name !== before) {
    // Keep the readable patient_name column in the other tabs in step.
    ['Visits', 'Payments', 'Appointments'].forEach((name) => {
      const t = table_(name);
      t.load().filter((r) => r.patient_id === id).forEach((r) => {
        r.patient_name = p.name;
        t.writeRow(r._row, r);
      });
    });
  }
  return p;
});

route_('DELETE', /^\/api\/patients\/(\d+)$/, DOCTOR, (ctx) => {
  const id = intId_(ctx.params[0]);
  requirePatient_(id);
  table_('Appointments').load().filter((a) => a.patient_id === id).forEach(removeFromCalendar_);
  table_('Patients').remove(id);
  ['Visits', 'Payments', 'Appointments'].forEach((name) => table_(name).removeWhere((r) => r.patient_id === id));
  return { ok: true };
});

// --- visits ---
route_('POST', /^\/api\/patients\/(\d+)\/visits$/, STAFF, (ctx) => {
  const pid = intId_(ctx.params[0]);
  const p = requirePatient_(pid);
  const visit = readVisit_(ctx.body);
  const paidNow = money_(ctx.body.paid_now, { field: 'Paid now' });
  const by = ctx.user.role;
  const row = table_('Visits').insert(Object.assign({ patient_id: pid, patient_name: p.name, created_by: by }, visit));
  if (paidNow > 0) {
    table_('Payments').insert({
      patient_id: pid, patient_name: p.name, date: visit.date, amount: paidNow,
      method: oneOf_(ctx.body.paid_method, PAYMENT_METHODS, 'Other'),
      note: visit.treatment ? ('For: ' + visit.treatment).slice(0, 500) : null,
      event_id: visit.event_id, created_by: by,
    });
  }
  if (visit.next_visit && ctx.body.book_next) {
    const appt = table_('Appointments').insert({
      patient_id: pid, patient_name: p.name, date: visit.next_visit, time: null,
      purpose: visit.treatment ? ('Follow-up: ' + visit.treatment).slice(0, 300) : 'Follow-up', status: 'scheduled', created_by: by,
    });
    const calId = syncCalendar_(appt, p);
    if (calId) table_('Appointments').update(appt.id, { calendar_event_id: calId });
  }
  return row;
});

route_('PUT', /^\/api\/visits\/(\d+)$/, DOCTOR, (ctx) => table_('Visits').update(intId_(ctx.params[0]), readVisit_(ctx.body)));
route_('DELETE', /^\/api\/visits\/(\d+)$/, DOCTOR, (ctx) => { table_('Visits').remove(intId_(ctx.params[0])); return { ok: true }; });

// --- payments ---
route_('POST', /^\/api\/patients\/(\d+)\/payments$/, STAFF, (ctx) => {
  const pid = intId_(ctx.params[0]);
  const p = requirePatient_(pid);
  return table_('Payments').insert(Object.assign({ patient_id: pid, patient_name: p.name, created_by: ctx.user.role }, readPayment_(ctx.body)));
});
route_('PUT', /^\/api\/payments\/(\d+)$/, DOCTOR, (ctx) => table_('Payments').update(intId_(ctx.params[0]), readPayment_(ctx.body)));
route_('DELETE', /^\/api\/payments\/(\d+)$/, DOCTOR, (ctx) => { table_('Payments').remove(intId_(ctx.params[0])); return { ok: true }; });

// --- appointments ---
route_('GET', /^\/api\/appointments$/, STAFF, (ctx) => {
  const from = date_(ctx.query.from) || today_(ctx.query);
  const to = date_(ctx.query.to) || from;
  return withPatient_(table_('Appointments').load().filter((a) => a.date >= from && a.date <= to)).sort(byTime_);
});

route_('GET', /^\/api\/appointments\/(\d+)$/, STAFF, (ctx) => {
  const a = table_('Appointments').get(intId_(ctx.params[0]));
  const rows = a ? withPatient_([a]) : [];
  if (!rows.length) throw new HttpError(404, 'Appointment not found');
  return rows[0];
});

route_('POST', /^\/api\/appointments$/, STAFF, (ctx) => {
  const pid = intId_(ctx.body.patient_id);
  const p = requirePatient_(pid);
  const t = table_('Appointments');
  const appt = t.insert(Object.assign({ patient_id: pid, patient_name: p.name, created_by: ctx.user.role }, readAppointment_(ctx.body)));
  const calId = syncCalendar_(appt, p);
  return calId ? t.update(appt.id, { calendar_event_id: calId }) : appt;
});

route_('PUT', /^\/api\/appointments\/(\d+)$/, STAFF, (ctx) => {
  const id = intId_(ctx.params[0]);
  const t = table_('Appointments');
  const existing = t.get(id);
  if (!existing) throw new HttpError(404, 'Not found');
  const next = readAppointment_(Object.assign({}, existing, ctx.body));
  const changed = ['date', 'time', 'purpose', 'status'].some((k) => next[k] !== existing[k]);
  if (next.date !== existing.date) next.patient_reminded = null;
  const updated = t.update(id, next);
  if (changed) {
    const calId = syncCalendar_(updated, table_('Patients').get(updated.patient_id));
    if (calId !== updated.calendar_event_id) t.update(id, { calendar_event_id: calId });
  }
  return updated;
});

route_('DELETE', /^\/api\/appointments\/(\d+)$/, STAFF, (ctx) => {
  const id = intId_(ctx.params[0]);
  const a = table_('Appointments').get(id);
  if (!a) throw new HttpError(404, 'Not found');
  removeFromCalendar_(a);
  table_('Appointments').remove(id);
  return { ok: true };
});

// --- accounts receivable ---
route_('GET', /^\/api\/receivables$/, STAFF, (ctx) => {
  const t = today_(ctx.query);
  const res = receivableRows_(t);
  const rows = res.rows.filter((r) => r.balance > 0)
    .map((r) => Object.assign({}, r, {
      name: res.patients[r.patient_id].name,
      phone: res.patients[r.patient_id].phone,
      days_overdue: r.oldest_due ? daysBetween_(r.oldest_due, t) : 0,
    }))
    .sort((a, b) => b.balance - a.balance);
  const totals = { balance: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  rows.forEach((r) => {
    totals.balance += r.balance;
    ['d0_30', 'd31_60', 'd61_90', 'd90_plus'].forEach((k) => { totals[k] += r.aging[k]; });
  });
  Object.keys(totals).forEach((k) => { totals[k] = round2_(totals[k]); });
  const advances = res.rows.filter((r) => r.balance < 0)
    .map((r) => ({ patient_id: r.patient_id, name: res.patients[r.patient_id].name, credit: -r.balance }));
  return { as_of: t, totals: totals, rows: rows, advances: advances };
});

/** Writes the current dues list into a "Dues Report" tab of the spreadsheet. */
route_('POST', /^\/api\/receivables\/sheet$/, DOCTOR, (ctx) => {
  const t = today_(ctx.query);
  const res = receivableRows_(t);
  const rows = res.rows.filter((r) => r.balance !== 0).sort((a, b) => b.balance - a.balance);
  const header = ['Patient ID', 'Name', 'Phone', 'Billed', 'Paid', 'Balance', '0-30 days', '31-60 days', '61-90 days', '90+ days', 'Oldest due', 'Last payment'];
  const data = rows.map((r) => {
    const p = res.patients[r.patient_id];
    return [r.patient_id, writeCell_('name', p.name), writeCell_('phone', p.phone), r.billed, r.paid, r.balance,
      r.aging.d0_30, r.aging.d31_60, r.aging.d61_90, r.aging.d90_plus, r.oldest_due || '', r.last_payment || ''];
  });
  const total = (i) => round2_(data.reduce((s, row) => s + row[i], 0));
  let sh = ss_().getSheetByName(DUES_SHEET);
  if (!sh) sh = ss_().insertSheet(DUES_SHEET);
  sh.clear();
  sh.getRange(1, 1, 1, 2).setValues([['Dues as of ' + t, '']]);
  sh.getRange(1, 1, 1, 2).setFontWeight('bold');
  sh.getRange(3, 1, 1, header.length).setValues([header]);
  sh.getRange(3, 1, 1, header.length).setFontWeight('bold');
  sh.getRange(3, 1, 1, header.length).setBackground('#d9f2ef');
  if (data.length) {
    sh.getRange(4, 1, data.length, header.length).setNumberFormats(data.map(() => ['0', '@', '@', '#,##0.00', '#,##0.00', '#,##0.00', '#,##0.00', '#,##0.00', '#,##0.00', '#,##0.00', '@', '@']));
    sh.getRange(4, 1, data.length, header.length).setValues(data);
    const totalRow = ['', 'TOTAL', '', total(3), total(4), total(5), total(6), total(7), total(8), total(9), '', ''];
    sh.getRange(4 + data.length, 1, 1, header.length).setValues([totalRow]);
    sh.getRange(4 + data.length, 1, 1, header.length).setFontWeight('bold');
  }
  return { url: ss_().getUrl() + '#gid=' + sh.getSheetId(), rows: data.length };
});

// --- events ---
route_('GET', /^\/api\/events\/options$/, STAFF, () =>
  table_('Events').all().sort(byDateDesc_).map((e) => ({ id: e.id, name: e.name, date: e.date, end_date: e.end_date })));

route_('GET', /^\/api\/events$/, DOCTOR, () => table_('Events').all().sort(byDateDesc_).map(eventSummary_));

route_('POST', /^\/api\/events$/, DOCTOR, (ctx) => table_('Events').insert(readEvent_(ctx.body)));

route_('GET', /^\/api\/events\/(\d+)$/, DOCTOR, (ctx) => {
  const id = intId_(ctx.params[0]);
  const ev = table_('Events').get(id);
  if (!ev) throw new HttpError(404, 'Event not found');
  const expenses = table_('Expenses').load().filter((x) => x.event_id === id).sort(byDateDesc_);
  const income = table_('Income').load().filter((x) => x.event_id === id).sort(byDateDesc_);
  return {
    event: eventSummary_(ev),
    expenses: expenses,
    expense_by_category: categoryTotals_(expenses),
    income: income,
    payments: withPatient_(table_('Payments').load().filter((p) => p.event_id === id)).sort(byDateDesc_),
    visits: withPatient_(table_('Visits').load().filter((v) => v.event_id === id)).sort(byDateDesc_),
  };
});

route_('PUT', /^\/api\/events\/(\d+)$/, DOCTOR, (ctx) => {
  const id = intId_(ctx.params[0]);
  const before = table_('Events').get(id);
  if (!before) throw new HttpError(404, 'Event not found');
  const oldName = before.name;
  const ev = table_('Events').update(id, readEvent_(ctx.body));
  if (ev.name !== oldName) {
    ['Expenses', 'Income'].forEach((name) => {
      const t = table_(name);
      t.load().filter((r) => r.event_id === id).forEach((r) => { r.event_name = ev.name; t.writeRow(r._row, r); });
    });
  }
  return ev;
});

/** Deleting an event keeps its money records; they simply become regular clinic records. */
route_('DELETE', /^\/api\/events\/(\d+)$/, DOCTOR, (ctx) => {
  const id = intId_(ctx.params[0]);
  table_('Events').remove(id);
  ['Visits', 'Payments', 'Expenses', 'Income'].forEach((name) => {
    const t = table_(name);
    t.load().filter((r) => r.event_id === id).forEach((r) => {
      r.event_id = null;
      if ('event_name' in r) r.event_name = null;
      t.writeRow(r._row, r);
    });
  });
  return { ok: true };
});

// --- expenses & other income ---
function ledgerRoutes_(path, tableName, categories, partyField) {
  const base = new RegExp('^\\/api\\/' + path + '$');
  const one = new RegExp('^\\/api\\/' + path + '\\/(\\d+)$');
  route_('GET', base, DOCTOR, (ctx) => {
    const t = today_(ctx.query);
    const from = date_(ctx.query.from) || t.slice(0, 7) + '-01';
    const to = date_(ctx.query.to) || t;
    const scope = ctx.query.scope || 'all'; // all | regular | events
    const rows = table_(tableName).all()
      .filter((r) => r.date >= from && r.date <= to)
      .filter((r) => scope === 'all' || (scope === 'regular' ? !r.event_id : !!r.event_id))
      .sort(byDateDesc_);
    return { from: from, to: to, total: sum_(rows, 'amount'), by_category: categoryTotals_(rows), rows: rows, categories: categories };
  });
  route_('GET', one, DOCTOR, (ctx) => {
    const r = table_(tableName).get(intId_(ctx.params[0]));
    if (!r) throw new HttpError(404, 'Not found');
    return r;
  });
  route_('POST', base, DOCTOR, (ctx) =>
    table_(tableName).insert(Object.assign({ created_by: ctx.user.role }, readLedger_(ctx.body, categories, partyField))));
  route_('PUT', one, DOCTOR, (ctx) => table_(tableName).update(intId_(ctx.params[0]), readLedger_(ctx.body, categories, partyField)));
  route_('DELETE', one, DOCTOR, (ctx) => { table_(tableName).remove(intId_(ctx.params[0])); return { ok: true }; });
}
ledgerRoutes_('expenses', 'Expenses', EXPENSE_CATEGORIES, 'paid_to');
ledgerRoutes_('income', 'Income', INCOME_CATEGORIES, 'received_from');

// --- profitability ---
route_('GET', /^\/api\/profitability$/, DOCTOR, (ctx) => {
  const t = today_(ctx.query);
  const from = date_(ctx.query.from) || t.slice(0, 7) + '-01';
  const to = date_(ctx.query.to) || t;
  const inRange = (r) => r.date && r.date >= from && r.date <= to;
  const payments = table_('Payments').load().filter(inRange);
  const income = table_('Income').load().filter(inRange);
  const expenses = table_('Expenses').load().filter(inRange);
  const split = (rows, wantEvent) => rows.filter((r) => (wantEvent ? !!r.event_id : !r.event_id));
  const block = (wantEvent) => {
    const patientIncome = sum_(split(payments, wantEvent), 'amount');
    const otherIncome = sum_(split(income, wantEvent), 'amount');
    const exp = sum_(split(expenses, wantEvent), 'amount');
    const inc = round2_(patientIncome + otherIncome);
    return { patient_income: patientIncome, other_income: otherIncome, income: inc, expenses: exp, profit: round2_(inc - exp) };
  };
  const regular = block(false);
  const events = block(true);
  // Events that ran in this period (or had money activity in it), with their all-time result.
  const active = {};
  payments.concat(income, expenses).forEach((r) => { if (r.event_id) active[r.event_id] = true; });
  const eventRows = table_('Events').all()
    .filter((e) => active[e.id] || (e.date <= to && (e.end_date || e.date) >= from))
    .sort(byDateDesc_)
    .map(eventSummary_);
  return {
    from: from,
    to: to,
    regular: regular,
    events: events,
    total: {
      income: round2_(regular.income + events.income),
      expenses: round2_(regular.expenses + events.expenses),
      profit: round2_(regular.profit + events.profit),
    },
    expense_by_category: categoryTotals_(split(expenses, false)),
    event_list: eventRows,
  };
});

// --- reports ---
route_('GET', /^\/api\/reports$/, DOCTOR, (ctx) => {
  const t = today_(ctx.query);
  const from = date_(ctx.query.from) || t.slice(0, 7) + '-01';
  const to = date_(ctx.query.to) || t;
  const inRange = (d) => d && d >= from && d <= to;
  const visits = table_('Visits').load().filter((v) => inRange(v.date));
  const payments = table_('Payments').load().filter((p) => inRange(p.date));
  const daily = {};
  const day = (d) => { if (!daily[d]) daily[d] = { date: d, visits: 0, billed: 0, collected: 0 }; return daily[d]; };
  visits.forEach((v) => { const r = day(v.date); r.visits += 1; r.billed = round2_(r.billed + (v.fee || 0)); });
  payments.forEach((p) => { const r = day(p.date); r.collected = round2_(r.collected + (p.amount || 0)); });

  const methods = {};
  payments.forEach((p) => {
    if (!methods[p.method]) methods[p.method] = { method: p.method, total: 0, count: 0 };
    methods[p.method].total = round2_(methods[p.method].total + p.amount);
    methods[p.method].count += 1;
  });
  const treatments = {};
  visits.filter((v) => v.treatment).forEach((v) => {
    const k = v.treatment.toLowerCase();
    if (!treatments[k]) treatments[k] = { treatment: v.treatment, count: 0, total: 0 };
    treatments[k].count += 1;
    treatments[k].total = round2_(treatments[k].total + (v.fee || 0));
  });
  const values = (o) => Object.keys(o).map((k) => o[k]);
  const patientIds = {};
  visits.forEach((v) => { patientIds[v.patient_id] = true; });

  return {
    from: from,
    to: to,
    billed: sum_(visits, 'fee'),
    collected: sum_(payments, 'amount'),
    visits: visits.length,
    patients_seen: Object.keys(patientIds).length,
    new_patients: table_('Patients').load().filter((p) => inRange(String(p.created_at || '').slice(0, 10))).length,
    by_method: values(methods).sort((a, b) => b.total - a.total),
    top_treatments: values(treatments).sort((a, b) => b.count - a.count).slice(0, 10),
    daily: values(daily).sort((a, b) => b.date.localeCompare(a.date)),
  };
});
