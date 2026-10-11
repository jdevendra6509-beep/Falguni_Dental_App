'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadBackend } = require('../dev/gas-mock');
const { build } = require('../scripts/build');

const { gas, spreadsheet } = loadBackend();

function call(method, url, body) {
  const res = JSON.parse(gas.api(method, url, body));
  return res.ok ? { status: 200, data: res.data } : { status: res.status, data: res };
}

test('creates the tabs with headers and default settings on first use', () => {
  const s = call('GET', '/api/settings').data;
  assert.equal(s.clinic_name, 'Falguni Dental Clinic');
  assert.equal(s.setup_done, '');
  assert.match(s.spreadsheet_url, /docs\.google\.com/);
  for (const name of ['Patients', 'Visits', 'Payments', 'Appointments', 'Settings']) {
    assert.ok(spreadsheet.getSheetByName(name), `${name} tab exists`);
  }
  assert.deepEqual(spreadsheet.getSheetByName('Payments').dump()[0], ['id', 'patient_id', 'patient_name', 'date', 'amount', 'method', 'note', 'created_at']);
  const saved = call('PUT', '/api/settings', { clinic_name: 'Smile Care', doctor_name: 'Dr. F', setup_done: 'yes' }).data;
  assert.equal(saved.clinic_name, 'Smile Care');
  assert.equal(call('GET', '/api/settings').data.doctor_name, 'Dr. F');
  assert.equal(spreadsheet.getSheetByName('Settings').dump().filter((r) => r[0] === 'clinic_name').length, 1, 'setting updated in place');
});

test('patients, visits, payments and receivables ageing', () => {
  assert.equal(call('POST', '/api/patients', { name: '' }).status, 400);
  const asha = call('POST', '/api/patients', { name: 'Asha Patel', phone: '+91 98765 43210', age: 34, allergies: 'Penicillin' }).data;
  const ravi = call('POST', '/api/patients', { name: 'Ravi Shah', phone: '09000000001' }).data;
  assert.deepEqual([asha.id, ravi.id], [1, 2]);

  // Asha: 3000 billed 100 days ago, 2000 billed 10 days ago, 3500 paid → 1500 open, all from the recent
  // charge after FIFO (payments clear the oldest charge first).
  const today = '2026-06-30';
  call('POST', `/api/patients/${asha.id}/visits`, { date: '2026-03-22', treatment: 'RCT 36', teeth: '36', fee: 3000, paid_now: 1000, paid_method: 'UPI' });
  call('POST', `/api/patients/${asha.id}/visits`, { date: '2026-06-20', treatment: 'Crown 36', fee: 2000, next_visit: '2026-07-01', book_next: true });
  call('POST', `/api/patients/${asha.id}/payments`, { date: '2026-06-25', amount: 2500, method: 'Cash' });
  // Ravi: 800 billed 70 days ago, nothing paid.
  call('POST', `/api/patients/${ravi.id}/visits`, { date: '2026-04-21', treatment: 'Filling', fee: 800 });

  const detail = call('GET', `/api/patients/${asha.id}?today=${today}`).data;
  assert.equal(detail.patient.phone, '+91 98765 43210', 'phone kept as text');
  assert.equal(detail.visits.length, 2);
  assert.equal(detail.visits[0].date, '2026-06-20', 'dates come back as YYYY-MM-DD text');
  assert.equal(detail.payments.length, 2);
  assert.equal(detail.appointments.length, 1, 'follow-up appointment was booked');
  assert.deepEqual(
    { billed: detail.account.billed, paid: detail.account.paid, balance: detail.account.balance },
    { billed: 5000, paid: 3500, balance: 1500 },
  );
  assert.equal(detail.account.aging.d0_30, 1500);
  assert.equal(detail.account.aging.d90_plus, 0);
  assert.equal(call('GET', `/api/patients/${ravi.id}`).data.patient.phone, '09000000001', 'leading zero kept');

  const ar = call('GET', `/api/receivables?today=${today}`).data;
  assert.equal(ar.totals.balance, 2300);
  assert.equal(ar.totals.d61_90, 800);
  assert.equal(ar.rows[0].name, 'Asha Patel');
  assert.equal(ar.rows[1].days_overdue, 70);

  assert.equal(call('GET', `/api/patients?filter=due&today=${today}`).data.length, 2);
  assert.deepEqual(call('GET', '/api/patients?q=43210').data.map((p) => p.name), ['Asha Patel']);
  assert.deepEqual(call('GET', '/api/patients?q=asha').data.map((p) => p.name), ['Asha Patel']);
  assert.ok(call('GET', `/api/patients?q=P-000${ravi.id}`).data.some((p) => p.id === ravi.id));

  // Overpayment becomes an advance.
  call('POST', `/api/patients/${ravi.id}/payments`, { date: '2026-06-30', amount: 1000, method: 'Card' });
  const ar2 = call('GET', `/api/receivables?today=${today}`).data;
  assert.equal(ar2.rows.length, 1);
  assert.deepEqual(ar2.advances.map((a) => a.credit), [200]);

  assert.equal(call('POST', `/api/patients/${ravi.id}/payments`, { date: '2026-06-30', amount: 0 }).status, 400);
  assert.equal(call('POST', `/api/patients/${ravi.id}/visits`, { date: 'yesterday' }).status, 400);

  // Readable patient_name column in the Visits tab follows a rename.
  call('PUT', `/api/patients/${ravi.id}`, { name: 'Ravi K. Shah', phone: '09000000001' });
  const visitRows = spreadsheet.getSheetByName('Visits').dump();
  assert.ok(visitRows.some((r) => r[1] === ravi.id && r[2] === 'Ravi K. Shah'));
});

test('appointments, dashboard and reports', () => {
  const p = call('POST', '/api/patients', { name: 'Meera Joshi' }).data;
  const appt = call('POST', '/api/appointments', { patient_id: p.id, date: '2026-06-30', time: '10:30', purpose: 'Checkup' }).data;
  assert.equal(appt.status, 'scheduled');
  const fetched = call('GET', `/api/appointments/${appt.id}`).data;
  assert.equal(fetched.patient_name, 'Meera Joshi');
  assert.equal(fetched.time, '10:30', 'time stays HH:MM text');
  assert.equal(call('POST', '/api/appointments', { patient_id: p.id, date: '2026-06-30', time: '25' }).status, 400);
  call('PUT', `/api/appointments/${appt.id}`, { status: 'done' });
  const day = call('GET', '/api/appointments?from=2026-06-30&to=2026-06-30').data;
  assert.equal(day.find((a) => a.id === appt.id).status, 'done');

  const dash = call('GET', '/api/dashboard?today=2026-06-30').data;
  assert.equal(dash.collected_today, 1000);
  assert.equal(dash.outstanding, 1500);
  assert.equal(dash.appointments_today.length, 1);
  assert.equal(dash.followups.length, 0, 'follow-up already booked');

  const rep = call('GET', '/api/reports?from=2026-06-01&to=2026-06-30').data;
  assert.equal(rep.collected, 3500);
  assert.equal(rep.billed, 2000);
  assert.deepEqual(rep.by_method.map((m) => m.method).sort(), ['Card', 'Cash']);
});

test('dues report tab', () => {
  const res = call('POST', '/api/receivables/sheet?today=2026-06-30', {}).data;
  assert.match(res.url, /#gid=\d+/);
  const rows = spreadsheet.getSheetByName('Dues Report').dump();
  assert.equal(rows[0][0], 'Dues as of 2026-06-30');
  assert.equal(rows[3][1], 'Asha Patel');
  assert.equal(rows[rows.length - 1][1], 'TOTAL');
});

test('text that looks like a formula is stored as text', () => {
  const p = call('POST', '/api/patients', { name: '=HYPERLINK("x")', notes: '-2 crowns' }).data;
  const back = call('GET', `/api/patients/${p.id}`).data.patient;
  assert.equal(back.name, '=HYPERLINK("x")');
  assert.equal(back.notes, '-2 crowns');
});

test('deleting a patient removes their rows from every tab', () => {
  const p = call('POST', '/api/patients', { name: 'Temp' }).data;
  call('POST', `/api/patients/${p.id}/visits`, { date: '2026-06-01', fee: 500, paid_now: 100 });
  call('POST', '/api/appointments', { patient_id: p.id, date: '2026-07-01' });
  assert.equal(call('DELETE', `/api/patients/${p.id}`).status, 200);
  assert.equal(call('GET', `/api/patients/${p.id}`).status, 404);
  for (const name of ['Visits', 'Payments', 'Appointments']) {
    assert.ok(!spreadsheet.getSheetByName(name).dump().some((r) => r[1] === p.id), `${name} cleaned`);
  }
  // Ids keep increasing after deletes elsewhere and no rows were damaged.
  assert.equal(call('GET', '/api/receivables?today=2026-06-30').data.totals.balance, 1500);
});

test('handles more rows than the sheet initially has', () => {
  const sheet = spreadsheet.getSheetByName('Payments');
  const p = call('POST', '/api/patients', { name: 'Bulk' }).data;
  sheet.maxRows = sheet.getLastRow() + 1;
  for (let i = 0; i < 3; i++) call('POST', `/api/patients/${p.id}/payments`, { date: '2026-06-01', amount: 10 });
  assert.equal(call('GET', `/api/patients/${p.id}`).data.payments.length, 3);
});

test('serves the web page and the built page is up to date', () => {
  const page = gas.doGet();
  assert.match(page.getContent(), /<main id="view"/);
  assert.equal(page.title, 'Smile Care');
  const built = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Index.html'), 'utf8');
  assert.equal(built, build(), 'apps-script/Index.html is stale — run `npm run build`');
});
