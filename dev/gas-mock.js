'use strict';

/**
 * A small in-memory stand-in for the Google Apps Script services Code.gs uses
 * (SpreadsheetApp, LockService, Utilities, Session, HtmlService), so the backend
 * can be tested and run locally. It copies the Sheets behaviours that matter:
 * text that looks like a date/time/number is converted unless the cell is
 * formatted as plain text ('@'), and a leading apostrophe forces text.
 */

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

function formatDate(d, _tz, pattern) {
  // The mock keeps everything in the machine's local time zone.
  const map = {
    yyyy: d.getFullYear(), MM: pad(d.getMonth() + 1), dd: pad(d.getDate()),
    HH: pad(d.getHours()), mm: pad(d.getMinutes()), ss: pad(d.getSeconds()),
  };
  return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, (k) => map[k]);
}

/** Loads Code.gs into a fresh sandbox backed by a new in-memory spreadsheet. */
function loadBackend({ spreadsheet = new Spreadsheet() } = {}) {
  const htmlFile = path.join(__dirname, '..', 'apps-script', 'Index.html');
  const context = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addToUi() {} }) }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
    Utilities: { formatDate },
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
  return { gas: context, spreadsheet };
}

module.exports = { loadBackend, Spreadsheet };
