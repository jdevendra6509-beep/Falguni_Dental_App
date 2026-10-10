'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS patients (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  phone           TEXT,
  email           TEXT,
  gender          TEXT,
  dob             TEXT,
  age             INTEGER,
  address         TEXT,
  medical_history TEXT,
  allergies       TEXT,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_patients_name  ON patients(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);

-- A visit is one clinical encounter. Its fee is the amount billed (a receivable).
CREATE TABLE IF NOT EXISTS visits (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id  INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  complaint   TEXT,
  diagnosis   TEXT,
  treatment   TEXT,
  teeth       TEXT,
  notes       TEXT,
  fee         REAL NOT NULL DEFAULT 0,
  next_visit  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_visits_patient ON visits(patient_id, date);
CREATE INDEX IF NOT EXISTS idx_visits_date    ON visits(date);

CREATE TABLE IF NOT EXISTS payments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id  INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  amount      REAL NOT NULL,
  method      TEXT NOT NULL DEFAULT 'Cash',
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_patient ON payments(patient_id, date);
CREATE INDEX IF NOT EXISTS idx_payments_date    ON payments(date);

CREATE TABLE IF NOT EXISTS appointments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id  INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  time        TEXT,
  purpose     TEXT,
  status      TEXT NOT NULL DEFAULT 'scheduled',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_appts_date ON appointments(date, time);
`;

const DEFAULT_SETTINGS = {
  clinic_name: 'Falguni Dental Clinic',
  doctor_name: '',
  clinic_phone: '',
  clinic_address: '',
  currency: '₹',
  country_code: '91',
  reminder_template:
    'Hello {name}, this is a gentle reminder from {clinic} that an amount of {amount} is pending for your dental treatment. Thank you!',
};

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insert.run(k, v);
  return db;
}

module.exports = { open, DEFAULT_SETTINGS };
