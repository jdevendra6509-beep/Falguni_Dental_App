'use strict';

/**
 * A small in-memory stand-in for the Google Apps Script services Code.gs uses
 * (SpreadsheetApp, LockService, Utilities, Session, HtmlService), so the backend
 * can be tested and run locally. It copies the Sheets behaviours that matter:
 * text that looks like a date/time/number is converted unless the cell is
 * formatted as plain text ('@'), and a leading apostrophe forces text.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function coerce(value, format) {
  if (typeof value !== 'string') return value;
  if (value.startsWith("'")) return value.slice(1);
  if (format === '@') return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value + 'T00:00:00');
  if (/^\d{1,2}:\d{2}$/.test(value)) {
    const [h, m] = value.split(':').map(Number);
    return new Date(1899, 11, 30, h, m);
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith('=')) throw new Error('Formulas are not supported in the mock: ' + value);
  return value;
}

class Range {
  constructor(sheet, row, col, rows, cols) {
    if (row < 1 || col < 1 || rows < 1 || cols < 1) throw new Error('Range out of bounds');
    if (row + rows - 1 > sheet.maxRows) throw new Error(`Range out of bounds: row ${row + rows - 1} > ${sheet.maxRows}`);
    Object.assign(this, { sheet, row, col, rows, cols });
  }
  each(fn) {
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) fn(this.row - 1 + r, this.col - 1 + c, r, c);
  }
  getValues() {
    const out = Array.from({ length: this.rows }, () => Array(this.cols).fill(''));
    this.each((R, C, r, c) => { out[r][c] = this.sheet.cell(R, C).v; });
    return out;
  }
  setValues(values) {
    if (values.length !== this.rows || values.some((row) => row.length !== this.cols)) throw new Error('Dimension mismatch');
    this.each((R, C, r, c) => {
      const cell = this.sheet.cell(R, C);
      cell.v = coerce(values[r][c] === undefined || values[r][c] === null ? '' : values[r][c], cell.f);
    });
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setNumberFormats(formats) {
    this.each((R, C, r, c) => { this.sheet.cell(R, C).f = formats[r][c]; });
    return this;
  }
  setNumberFormat(f) { this.each((R, C) => { this.sheet.cell(R, C).f = f; }); return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
}

class Sheet {
  constructor(name, id) {
    this.name = name;
    this.id = id;
    this.data = [];
    this.maxRows = 1000;
    this.frozen = 0;
  }
  cell(r, c) {
    while (this.data.length <= r) this.data.push([]);
    const row = this.data[r];
    while (row.length <= c) row.push({ v: '', f: '' });
    return row[c];
  }
  getName() { return this.name; }
  getSheetId() { return this.id; }
  getMaxRows() { return this.maxRows; }
  getLastRow() {
    for (let r = this.data.length - 1; r >= 0; r--) if (this.data[r].some((c) => c.v !== '')) return r + 1;
    return 0;
  }
  getLastColumn() { return Math.max(0, ...this.data.map((row) => row.reduce((m, c, i) => (c.v !== '' ? i + 1 : m), 0))); }
  getRange(row, col, rows = 1, cols = 1) { return new Range(this, row, col, rows, cols); }
  getDataRange() { return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  insertRowsAfter(after, n) { this.maxRows += n; }
  deleteRow(r) {
    if (r - 1 < this.data.length) this.data.splice(r - 1, 1);
    this.maxRows -= 1;
  }
  setFrozenRows(n) { this.frozen = n; }
  clear() { this.data = []; }
  /** Test helper: the sheet as plain values, header included. */
  dump() { return this.getLastRow() ? this.getRange(1, 1, this.getLastRow(), this.getLastColumn()).getValues() : []; }
}

class Spreadsheet {
  constructor() {
    this.sheets = [];
    this.nextId = 1;
  }
  getSheetByName(name) { return this.sheets.find((s) => s.name === name) || null; }
  insertSheet(name) {
    if (this.getSheetByName(name)) throw new Error(`A sheet with the name "${name}" already exists.`);
    const s = new Sheet(name, this.nextId++);
    this.sheets.push(s);
    return s;
  }
  getSheets() { return this.sheets.slice(); }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/LOCAL-DEV/edit'; }
  getSpreadsheetTimeZone() { return 'Asia/Kolkata'; }
}

function pad(n) { return String(n).padStart(2, '0'); }

// The mock keeps everything in the machine's local time zone.
function formatDate(d, _tz, pattern) {
  const map = {
    yyyy: d.getFullYear(), MMM: d.toLocaleString('en', { month: 'short' }), MM: pad(d.getMonth() + 1),
    dd: pad(d.getDate()), d: d.getDate(), EEE: d.toLocaleString('en', { weekday: 'short' }),
    HH: pad(d.getHours()), mm: pad(d.getMinutes()), ss: pad(d.getSeconds()),
  };
  return pattern.replace(/yyyy|MMM|MM|dd|d|EEE|HH|mm|ss/g, (k) => map[k]);
}

function parseDate(str, _tz, pattern) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/.exec(str);
  if (!m || (pattern.includes('HH') !== !!m[4])) throw new Error(`Unparseable date "${str}" for ${pattern}`);
  return new Date(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
}

class CalendarEventMock {
  constructor(cal, id, title, start, end, opts, allDay) {
    Object.assign(this, { cal, id, title, start, end, opts, allDay, reminders: [] });
  }
  getId() { return this.id; }
  getTitle() { return this.title; }
  deleteEvent() { this.cal.events.delete(this.id); }
  removeAllReminders() { this.reminders = []; }
  addPopupReminder(min) { this.reminders.push(min); }
}

class CalendarMock {
  constructor(id, name) { Object.assign(this, { id, name, events: new Map(), seq: 0 }); }
  getId() { return this.id; }
  getName() { return this.name; }
  getEventById(id) { return this.events.get(id) || null; }
  createEvent(title, start, end, opts = {}) {
    if (!(end > start)) throw new Error('Event end must be after start');
    const ev = new CalendarEventMock(this, `ev${++this.seq}@google.com`, title, start, end, opts, false);
    this.events.set(ev.id, ev);
    return ev;
  }
  createAllDayEvent(title, day, opts = {}) {
    const ev = new CalendarEventMock(this, `ev${++this.seq}@google.com`, title, day, null, opts, true);
    this.events.set(ev.id, ev);
    return ev;
  }
}

function makeServices() {
  const calendars = new Map();
  const props = new Map();
  const cache = new Map();
  const mail = [];
  const triggers = [];
  return {
    calendars, props, mail, triggers,
    CalendarApp: {
      Color: { TEAL: 'teal' },
      getCalendarById: (id) => calendars.get(id) || null,
      createCalendar: (name) => {
        const c = new CalendarMock(`cal${calendars.size + 1}@group.calendar.google.com`, name);
        calendars.set(c.id, c);
        return c;
      },
    },
    MailApp: {
      sendEmail: (msg) => { mail.push(msg); },
      getRemainingDailyQuota: () => 100 - mail.length,
    },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1),
      newTrigger: (fn) => {
        const t = { fn, getHandlerFunction: () => fn };
        const b = { timeBased: () => b, everyDays: () => b, atHour: (h) => { t.hour = h; return b; }, inTimezone: () => b, create: () => { triggers.push(t); return t; } };
        return b;
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => { props.set(k, String(v)); },
        deleteProperty: (k) => { props.delete(k); },
        getKeys: () => [...props.keys()],
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache.has(k) ? cache.get(k) : null),
        put: (k, v) => { cache.set(k, String(v)); },
        remove: (k) => { cache.delete(k); },
      }),
    },
  };
}

/** Loads Code.gs into a fresh sandbox backed by a new in-memory spreadsheet. */
function loadBackend({ spreadsheet = new Spreadsheet(), owner = 'doctor@example.com' } = {}) {
  const htmlFile = path.join(__dirname, '..', 'apps-script', 'Index.html');
  const services = makeServices();
  const context = {
    console,
    CalendarApp: services.CalendarApp,
    MailApp: services.MailApp,
    ScriptApp: services.ScriptApp,
    PropertiesService: services.PropertiesService,
    CacheService: services.CacheService,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addToUi() {} }) }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Session: { getScriptTimeZone: () => 'Asia/Kolkata', getEffectiveUser: () => ({ getEmail: () => owner }) },
    Utilities: {
      formatDate,
      parseDate,
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      // Apps Script returns signed bytes (-128..127).
      computeDigest: (alg, value) => [...crypto.createHash(alg).update(String(value), 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
    },
    HtmlService: {
      createHtmlOutputFromFile: (name) => {
        const out = {
          content: fs.readFileSync(htmlFile, 'utf8'), name, title: '', meta: {},
          setTitle(t) { out.title = t; return out; },
          addMetaTag(k, v) { out.meta[k] = v; return out; },
          getContent() { return out.content; },
        };
        return out;
      },
    },
  };
  vm.createContext(context);
  const code = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  vm.runInContext(code, context, { filename: 'Code.gs' });
  return { gas: context, spreadsheet, services };
}

module.exports = { loadBackend, Spreadsheet };
