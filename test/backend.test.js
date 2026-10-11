'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadBackend } = require('../dev/gas-mock');
const { build } = require('../scripts/build');

const { gas, spreadsheet, services } = loadBackend();
const tokens = {};

function call(method, url, body, as = 'doctor') {
  const res = JSON.parse(gas.api(method, url, body === undefined ? null : body, as ? tokens[as] : null));
  return res.ok ? { status: 200, data: res.data } : { status: res.status, data: res };
}

test('first-run setup creates the doctor and compounder logins', () => {
  const st = call('GET', '/api/status', undefined, null).data;
  assert.equal(st.setup_required, true);
  assert.equal(call('GET', '/api/patients', undefined, null).status, 401, 'login required');
  assert.equal(call('POST', '/api/setup', { doctor_password: 'same', compounder_password: 'same' }, null).status, 400);
  assert.equal(call('POST', '/api/setup', { doctor_password: 'ab', compounder_password: 'abcd' }, null).status, 400);
  const res = call('POST', '/api/setup', {
    doctor_password: 'doc123', compounder_password: 'comp123', clinic_name: 'Smile Care',
    doctor_email: 'doctor@example.com', compounder_email: 'compounder@example.com',
  }, null);
  assert.equal(res.status, 200);
  assert.equal(res.data.role, 'doctor');
  tokens.doctor = res.data.token;
  assert.equal(call('POST', '/api/setup', { doctor_password: 'xxxx', compounder_password: 'yyyy' }, null).status, 409);
  assert.ok(![...services.props.values()].some((v) => v.includes('doc123')), 'passwords are not stored in plain text');
  assert.ok(!spreadsheet.getSheetByName('Settings').dump().some((r) => String(r[1]).includes('doc123')));

  assert.equal(call('POST', '/api/login', { role: 'compounder', password: 'doc123' }, null).status, 401);
  const comp = call('POST', '/api/login', { role: 'compounder', password: 'comp123' }, null);
  assert.equal(comp.data.role, 'compounder');
  tokens.compounder = comp.data.token;
  const me = call('GET', '/api/me', undefined, 'compounder').data;
  assert.equal(me.role, 'compounder');
  assert.equal(me.settings.clinic_name, 'Smile Care');
  assert.equal(me.settings.spreadsheet_url, undefined, 'compounder does not get the sheet link');
  assert.match(call('GET', '/api/me').data.settings.spreadsheet_url, /docs\.google\.com/);
  assert.equal(call('GET', '/api/me', undefined, null).status, 401);
});

test('blocks password guessing after 5 attempts', () => {
  for (let i = 0; i < 5; i++) assert.equal(call('POST', '/api/login', { role: 'doctor', password: 'nope' + i }, null).status, 401);
  assert.equal(call('POST', '/api/login', { role: 'doctor', password: 'doc123' }, null).status, 429);
  // The lock lives in CacheService; clear it for the rest of the tests.
  gas.CacheService.getScriptCache().remove('fails:doctor');
});

test('compounder cannot reach money, reports, settings or deletes', () => {
  for (const [m, u] of [
    ['GET', '/api/reports'], ['GET', '/api/profitability'], ['GET', '/api/expenses'], ['GET', '/api/income'],
    ['GET', '/api/events'], ['PUT', '/api/settings'], ['POST', '/api/receivables/sheet'], ['DELETE', '/api/patients/1'],
    ['DELETE', '/api/payments/1'], ['PUT', '/api/visits/1'], ['POST', '/api/passwords'],
  ]) {
    assert.equal(call(m, u, {}, 'compounder').status, 403, `${m} ${u}`);
  }
});

test('patients, visits, payments and receivables ageing', () => {
  assert.equal(call('POST', '/api/patients', { name: '' }).status, 400);
  const asha = call('POST', '/api/patients', { name: 'Asha Patel', phone: '+91 98765 43210', email: 'asha@example.com', age: 34, allergies: 'Penicillin' }).data;
  const ravi = call('POST', '/api/patients', { name: 'Ravi Shah', phone: '09000000001' }, 'compounder').data;
  assert.deepEqual([asha.id, ravi.id], [1, 2]);

  const today = '2026-06-30';
  call('POST', `/api/patients/${asha.id}/visits`, { date: '2026-03-22', treatment: 'RCT 36', teeth: '36', fee: 3000, paid_now: 1000, paid_method: 'UPI' });
  call('POST', `/api/patients/${asha.id}/visits`, { date: '2026-06-20', treatment: 'Crown 36', fee: 2000, next_visit: '2026-07-01', book_next: true });
  call('POST', `/api/patients/${asha.id}/payments`, { date: '2026-06-25', amount: 2500, method: 'Cash' }, 'compounder');
  call('POST', `/api/patients/${ravi.id}/visits`, { date: '2026-04-21', treatment: 'Filling', fee: 800 });

  const detail = call('GET', `/api/patients/${asha.id}?today=${today}`, undefined, 'compounder').data;
  assert.equal(detail.patient.phone, '+91 98765 43210', 'phone kept as text');
  assert.equal(detail.visits[0].date, '2026-06-20', 'dates come back as YYYY-MM-DD text');
  assert.equal(detail.payments.find((p) => p.amount === 2500).created_by, 'compounder');
  assert.equal(detail.appointments.length, 1, 'follow-up appointment was booked');
  assert.deepEqual(
    { billed: detail.account.billed, paid: detail.account.paid, balance: detail.account.balance },
    { billed: 5000, paid: 3500, balance: 1500 },
  );
  assert.equal(detail.account.aging.d0_30, 1500);
  assert.equal(call('GET', `/api/patients/${ravi.id}`).data.patient.phone, '09000000001', 'leading zero kept');

  const ar = call('GET', `/api/receivables?today=${today}`, undefined, 'compounder').data;
  assert.equal(ar.totals.balance, 2300);
  assert.equal(ar.totals.d61_90, 800);
  assert.equal(ar.rows[1].days_overdue, 70);

  assert.deepEqual(call('GET', '/api/patients?q=43210').data.map((p) => p.name), ['Asha Patel']);
  assert.ok(call('GET', `/api/patients?q=P-000${ravi.id}`).data.some((p) => p.id === ravi.id));

  call('POST', `/api/patients/${ravi.id}/payments`, { date: '2026-06-30', amount: 1000, method: 'Card' });
  const ar2 = call('GET', `/api/receivables?today=${today}`).data;
  assert.deepEqual(ar2.advances.map((a) => a.credit), [200]);
  assert.equal(call('POST', `/api/patients/${ravi.id}/payments`, { date: '2026-06-30', amount: 0 }).status, 400);

  call('PUT', `/api/patients/${ravi.id}`, { name: 'Ravi K. Shah', phone: '09000000001' }, 'compounder');
  assert.ok(spreadsheet.getSheetByName('Visits').dump().some((r) => r[1] === ravi.id && r[2] === 'Ravi K. Shah'));
});

test('appointments go to Google Calendar with a phone reminder', () => {
  const p = call('POST', '/api/patients', { name: 'Meera Joshi', phone: '9812345678' }).data;
  const appt = call('POST', '/api/appointments', { patient_id: p.id, date: '2026-06-30', time: '10:30', purpose: 'Checkup' }, 'compounder').data;
  assert.equal(appt.created_by, 'compounder');
  assert.ok(appt.calendar_event_id, 'calendar event created');
  const [cal] = services.calendars.values();
  assert.equal(cal.getName(), 'Clinic Appointments');
  const ev = cal.getEventById(appt.calendar_event_id);
  assert.equal(ev.getTitle(), '🦷 Meera Joshi – Checkup');
  assert.deepEqual(ev.reminders, [30]);
  assert.equal(ev.start.getHours(), 10);
  assert.equal(ev.end - ev.start, 30 * 60000);
  assert.equal(ev.opts.guests, 'compounder@example.com', 'compounder invited; the doctor owns the calendar');
  assert.match(ev.opts.description, /wa\.me\/919812345678/);

  // Rescheduling moves the calendar event; cancelling removes it.
  const moved = call('PUT', `/api/appointments/${appt.id}`, { time: '11:00' }).data;
  assert.notEqual(moved.calendar_event_id, appt.calendar_event_id);
  assert.equal(cal.getEventById(appt.calendar_event_id), null);
  assert.equal(cal.getEventById(moved.calendar_event_id).start.getHours(), 11);
  const done = call('PUT', `/api/appointments/${appt.id}`, { status: 'done' }).data;
  assert.equal(done.calendar_event_id, null);
  assert.equal(cal.events.size, 1, 'only the follow-up from the earlier test remains');

  const fetched = call('GET', `/api/appointments/${appt.id}`).data;
  assert.equal(fetched.time, '11:00', 'time stays HH:MM text');
  assert.equal(call('POST', '/api/appointments', { patient_id: p.id, date: '2026-06-30', time: '25' }).status, 400);

  const tmp = call('POST', '/api/appointments', { patient_id: p.id, date: '2026-07-02' }).data;
  assert.equal(cal.getEventById(tmp.calendar_event_id).allDay, true, 'no time → all-day event');
  call('DELETE', `/api/appointments/${tmp.id}`, undefined, 'compounder');
  assert.equal(cal.getEventById(tmp.calendar_event_id), null);
});

test('daily reminders: staff digest and patient emails, once per day', () => {
  const today = new Date();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const tomorrow = new Date(today.getTime() + 86400000);
  call('POST', '/api/appointments', { patient_id: 1, date: iso(today), time: '09:30', purpose: 'Crown fitting' });
  call('POST', '/api/appointments', { patient_id: 1, date: iso(tomorrow), time: '17:00', purpose: 'Review' });
  services.mail.length = 0;

  const msg = gas.dailyReminders();
  assert.match(msg, /Staff digest sent to 2/);
  assert.match(msg, /Patient emails sent: 1/);
  const digest = services.mail.find((m) => m.to.includes('doctor@example.com'));
  assert.match(digest.subject, /Today: 1 appointment/);
  assert.match(digest.htmlBody, /Asha Patel/);
  assert.match(digest.htmlBody, /wa\.me\/919876543210/);
  const patientMail = services.mail.find((m) => m.to === 'asha@example.com');
  assert.match(patientMail.body, /reminder of your dental appointment at Smile Care/);

  assert.equal(gas.dailyReminders(), 'Already sent today');
  assert.equal(services.mail.length, 2);
  assert.ok(services.triggers.length === 0, 'trigger is installed by setup(), not by the API');
  gas.setup();
  gas.setup();
  assert.equal(services.triggers.filter((tr) => tr.fn === 'dailyReminders').length, 1, 'setup is idempotent');
  assert.equal(call('GET', '/api/reminders/status').data.daily_trigger, true);
});

test('events, expenses, other income and profitability', () => {
  assert.equal(call('POST', '/api/events', { name: '', date: '2026-06-14' }).status, 400);
  const camp = call('POST', '/api/events', { name: 'School camp – St. Mary', type: 'School camp', date: '2026-06-14', location: 'Andheri' }).data;
  const options = call('GET', '/api/events/options', undefined, 'compounder').data;
  assert.deepEqual(options.map((o) => o.name), ['School camp – St. Mary']);

  // Patients treated at the camp, money tagged to the event.
  const kid = call('POST', '/api/patients', { name: 'Kid One' }, 'compounder').data;
  call('POST', `/api/patients/${kid.id}/visits`, { date: '2026-06-14', treatment: 'Screening', fee: 200, paid_now: 200, event_id: camp.id }, 'compounder');
  call('POST', `/api/patients/${kid.id}/visits`, { date: '2026-06-14', treatment: 'Sealant', fee: 600, event_id: camp.id }, 'compounder');
  call('POST', '/api/income', { date: '2026-06-14', category: 'Sponsorship', amount: 5000, received_from: 'St. Mary School', event_id: camp.id });
  call('POST', '/api/expenses', { date: '2026-06-13', category: 'Travel', amount: 1200, event_id: camp.id });
  call('POST', '/api/expenses', { date: '2026-06-14', category: 'Dental materials', amount: 2300, event_id: camp.id });
  // Regular clinic expenses.
  call('POST', '/api/expenses', { date: '2026-06-01', category: 'Rent', amount: 15000, paid_to: 'Landlord' });
  call('POST', '/api/expenses', { date: '2026-06-05', category: 'Lab charges', amount: 1800 });
  assert.equal(call('POST', '/api/expenses', { date: '2026-06-05', amount: 0 }).status, 400);
  assert.equal(call('POST', '/api/expenses', { date: '2026-06-05', amount: 10, event_id: 999 }).status, 400);

  const ev = call('GET', `/api/events/${camp.id}`).data;
  assert.deepEqual(
    pick(ev.event, ['patients_seen', 'visits', 'billed', 'patient_income', 'other_income', 'income', 'expenses', 'profit', 'margin']),
    { patients_seen: 1, visits: 2, billed: 800, patient_income: 200, other_income: 5000, income: 5200, expenses: 3500, profit: 1700, margin: 32.7 },
  );
  assert.deepEqual(ev.expense_by_category.map((c) => c.category), ['Dental materials', 'Travel']);
  assert.equal(spreadsheet.getSheetByName('Expenses').dump().find((r) => r[2] === 'Travel')[8], 'School camp – St. Mary', 'event name readable in the sheet');

  const pl = call('GET', '/api/profitability?from=2026-06-01&to=2026-06-30').data;
  // Regular: patient payments in June not tagged to an event = 2500 + 1000; expenses 15000 + 1800.
  assert.deepEqual(pl.regular, { patient_income: 3500, other_income: 0, income: 3500, expenses: 16800, profit: -13300 });
  assert.deepEqual(pl.events, { patient_income: 200, other_income: 5000, income: 5200, expenses: 3500, profit: 1700 });
  assert.deepEqual(pl.total, { income: 8700, expenses: 20300, profit: -11600 });
  assert.equal(pl.event_list.length, 1);
  assert.equal(pl.event_list[0].profit, 1700);

  const list = call('GET', '/api/expenses?from=2026-06-01&to=2026-06-30&scope=regular').data;
  assert.equal(list.total, 16800);
  assert.equal(call('GET', '/api/events').data[0].profit, 1700);

  const dash = call('GET', '/api/dashboard?today=2026-06-30').data;
  assert.equal(dash.month_profit, -11600);
  const compDash = call('GET', '/api/dashboard?today=2026-06-30', undefined, 'compounder').data;
  assert.equal(compDash.month_profit, undefined, 'compounder does not see profit');

  // Renaming an event updates the readable name; deleting it keeps the money as regular clinic records.
  call('PUT', `/api/events/${camp.id}`, { name: 'St. Mary camp', date: '2026-06-14' });
  assert.ok(spreadsheet.getSheetByName('Income').dump().some((r) => r[8] === 'St. Mary camp'));
  call('DELETE', `/api/events/${camp.id}`);
  const after = call('GET', '/api/profitability?from=2026-06-01&to=2026-06-30').data;
  assert.equal(after.total.profit, -11600, 'nothing lost');
  assert.equal(after.events.income, 0);
});

test('passwords can be changed by the doctor and old logins stop working', () => {
  assert.equal(call('POST', '/api/passwords', { role: 'compounder', current: 'wrong', password: 'new-pass' }).status, 400);
  assert.equal(call('POST', '/api/passwords', { role: 'compounder', current: 'doc123', password: 'new-pass' }).status, 200);
  assert.equal(call('GET', '/api/me', undefined, 'compounder').status, 401, 'compounder logged out');
  assert.equal(call('POST', '/api/login', { role: 'compounder', password: 'new-pass' }, null).status, 200);
  assert.equal(call('GET', '/api/me').status, 200, 'doctor still logged in');
  call('POST', '/api/logout', {});
  assert.equal(call('GET', '/api/me').status, 401);
  tokens.doctor = call('POST', '/api/login', { role: 'doctor', password: 'doc123' }, null).data.token;
});

test('dues report tab and formula-looking text', () => {
  const res = call('POST', '/api/receivables/sheet?today=2026-06-30', {}).data;
  assert.match(res.url, /#gid=\d+/);
  const rows = spreadsheet.getSheetByName('Dues Report').dump();
  assert.equal(rows[0][0], 'Dues as of 2026-06-30');
  assert.equal(rows[rows.length - 1][1], 'TOTAL');
  const p = call('POST', '/api/patients', { name: '=HYPERLINK("x")', notes: '-2 crowns' }).data;
  const back = call('GET', `/api/patients/${p.id}`).data.patient;
  assert.equal(back.name, '=HYPERLINK("x")');
  assert.equal(back.notes, '-2 crowns');
});

test('deleting a patient removes their rows and calendar events', () => {
  const p = call('POST', '/api/patients', { name: 'Temp' }).data;
  call('POST', `/api/patients/${p.id}/visits`, { date: '2026-06-01', fee: 500, paid_now: 100 });
  const a = call('POST', '/api/appointments', { patient_id: p.id, date: '2026-07-01', time: '12:00' }).data;
  assert.equal(call('DELETE', `/api/patients/${p.id}`).status, 200);
  assert.equal(call('GET', `/api/patients/${p.id}`).status, 404);
  for (const name of ['Visits', 'Payments', 'Appointments']) {
    assert.ok(!spreadsheet.getSheetByName(name).dump().some((r) => r[1] === p.id), `${name} cleaned`);
  }
  const [cal] = services.calendars.values();
  assert.equal(cal.getEventById(a.calendar_event_id), null);
});

test('adds new columns to sheets made by an older version', () => {
  const { gas: g2, spreadsheet: s2 } = loadBackend();
  const old = s2.insertSheet('Payments');
  old.getRange(1, 1, 1, 8).setValues([['id', 'patient_id', 'patient_name', 'date', 'amount', 'method', 'note', 'created_at']]);
  old.getRange(2, 1, 1, 8).setNumberFormats([['0', '0', '@', '@', '0', '@', '@', '@']]);
  old.getRange(2, 1, 1, 8).setValues([[1, 1, 'Old Patient', '2026-01-05', 700, 'Cash', '', '2026-01-05 10:00:00']]);
  JSON.parse(g2.api('GET', '/api/status', null, null));
  assert.deepEqual(s2.getSheetByName('Payments').dump()[0].slice(8), ['event_id', 'created_by']);
  assert.equal(s2.getSheetByName('Payments').dump()[1][4], 700, 'existing data untouched');
});

test('only the API and setup functions are reachable from the web page', () => {
  const callable = Object.keys(gas).filter((k) => typeof gas[k] === 'function' && !k.endsWith('_') && /^[a-z]/.test(k));
  assert.deepEqual(callable.sort(), ['api', 'dailyReminders', 'doGet', 'onOpen', 'setup']);
});

test('serves the web page and the built page is up to date', () => {
  const page = gas.doGet();
  assert.match(page.getContent(), /<main id="view"/);
  assert.equal(page.title, 'Smile Care');
  const built = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Index.html'), 'utf8');
  assert.equal(built, build(), 'apps-script/Index.html is stale — run `npm run build`');
});

function pick(o, keys) {
  return Object.fromEntries(keys.map((k) => [k, o[k]]));
}
