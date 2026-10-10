'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');

let server, base, cookie = '';

async function call(method, url, body, { auth = true } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(auth && cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

before(async () => {
  server = createApp({ dbFile: ':memory:' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((r) => server.close(r)));

test('first-run setup, login and auth guard', async () => {
  assert.equal((await call('GET', '/api/status')).data.setup_required, true);
  assert.equal((await call('GET', '/api/patients', null, { auth: false })).status, 401);
  assert.equal((await call('POST', '/api/setup', { password: 'ab' })).status, 400);
  const setup = await call('POST', '/api/setup', { password: 'secret1', clinic_name: 'Smile Care' });
  assert.equal(setup.status, 200);
  assert.equal((await call('POST', '/api/setup', { password: 'other12' })).status, 409);
  assert.equal((await call('GET', '/api/settings')).data.clinic_name, 'Smile Care');

  await call('POST', '/api/logout', {});
  cookie = '';
  assert.equal((await call('POST', '/api/login', { password: 'nope' })).status, 401);
  assert.equal((await call('POST', '/api/login', { password: 'secret1' })).status, 200);
  assert.equal((await call('GET', '/api/status')).data.authenticated, true);
});

test('rejects cross-origin writes', async () => {
  const res = await fetch(base + '/api/patients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://evil.example' },
    body: JSON.stringify({ name: 'X' }),
  });
  assert.equal(res.status, 403);
});

test('patients, visits, payments and receivables ageing', async () => {
  assert.equal((await call('POST', '/api/patients', { name: '' })).status, 400);
  const asha = (await call('POST', '/api/patients', { name: 'Asha Patel', phone: '98765 43210', age: 34, allergies: 'Penicillin' })).data;
  const ravi = (await call('POST', '/api/patients', { name: 'Ravi Shah', phone: '9000000001' })).data;
  assert.ok(asha.id && ravi.id);

  // Asha: 3000 billed 100 days ago, 2000 billed 10 days ago, 3500 paid → 1500 open, all from the recent charge
  // after FIFO (payments clear the oldest charge first).
  const today = '2026-06-30';
  await call('POST', `/api/patients/${asha.id}/visits`, { date: '2026-03-22', treatment: 'RCT 36', teeth: '36', fee: 3000, paid_now: 1000, paid_method: 'UPI' });
  await call('POST', `/api/patients/${asha.id}/visits`, { date: '2026-06-20', treatment: 'Crown 36', fee: 2000, next_visit: '2026-07-01', book_next: true });
  await call('POST', `/api/patients/${asha.id}/payments`, { date: '2026-06-25', amount: 2500, method: 'Cash' });
  // Ravi: 800 billed 70 days ago, nothing paid.
  await call('POST', `/api/patients/${ravi.id}/visits`, { date: '2026-04-21', treatment: 'Filling', fee: 800 });

  const detail = (await call('GET', `/api/patients/${asha.id}?today=${today}`)).data;
  assert.equal(detail.visits.length, 2);
  assert.equal(detail.payments.length, 2);
  assert.equal(detail.appointments.length, 1, 'follow-up appointment was booked');
  assert.deepEqual(
    { billed: detail.account.billed, paid: detail.account.paid, balance: detail.account.balance },
    { billed: 5000, paid: 3500, balance: 1500 },
  );
  assert.equal(detail.account.aging.d0_30, 1500);
  assert.equal(detail.account.aging.d90_plus, 0);

  const ar = (await call('GET', `/api/receivables?today=${today}`)).data;
  assert.equal(ar.totals.balance, 2300);
  assert.equal(ar.totals.d61_90, 800);
  assert.equal(ar.rows[0].name, 'Asha Patel');
  assert.equal(ar.rows[1].days_overdue, 70);

  const due = (await call('GET', `/api/patients?filter=due&today=${today}`)).data;
  assert.equal(due.length, 2);
  const byPhone = (await call('GET', '/api/patients?q=43210')).data;
  assert.deepEqual(byPhone.map((p) => p.name), ['Asha Patel']);
  const byCode = (await call('GET', `/api/patients?q=P-000${ravi.id}`)).data;
  assert.ok(byCode.some((p) => p.id === ravi.id));

  // Overpayment becomes an advance.
  await call('POST', `/api/patients/${ravi.id}/payments`, { date: '2026-06-30', amount: 1000, method: 'Card' });
  const ar2 = (await call('GET', `/api/receivables?today=${today}`)).data;
  assert.equal(ar2.rows.length, 1);
  assert.deepEqual(ar2.advances.map((a) => a.credit), [200]);

  assert.equal((await call('POST', `/api/patients/${ravi.id}/payments`, { date: '2026-06-30', amount: 0 })).status, 400);
  assert.equal((await call('POST', `/api/patients/${ravi.id}/visits`, { date: 'yesterday' })).status, 400);
});

test('appointments, dashboard and reports', async () => {
  const p = (await call('POST', '/api/patients', { name: 'Meera Joshi' })).data;
  const appt = (await call('POST', '/api/appointments', { patient_id: p.id, date: '2026-06-30', time: '10:30', purpose: 'Checkup' })).data;
  assert.equal(appt.status, 'scheduled');
  assert.equal((await call('GET', `/api/appointments/${appt.id}`)).data.patient_name, 'Meera Joshi');
  assert.equal((await call('POST', '/api/appointments', { patient_id: p.id, date: '2026-06-30', time: '25' })).status, 400);
  await call('PUT', `/api/appointments/${appt.id}`, { status: 'done' });
  const day = (await call('GET', '/api/appointments?from=2026-06-30&to=2026-06-30')).data;
  assert.equal(day.find((a) => a.id === appt.id).status, 'done');

  const dash = (await call('GET', '/api/dashboard?today=2026-06-30')).data;
  assert.equal(dash.collected_today, 1000);
  assert.equal(dash.outstanding, 1500);
  assert.equal(dash.appointments_today.length, 1);

  const rep = (await call('GET', '/api/reports?from=2026-06-01&to=2026-06-30')).data;
  assert.equal(rep.collected, 3500);
  assert.equal(rep.billed, 2000);
  assert.deepEqual(rep.by_method.map((m) => m.method).sort(), ['Card', 'Cash']);
});

test('csv export and backup download', async () => {
  const csv = await call('GET', '/api/export/payments.csv');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.data, /patient_name/);
  const backup = await fetch(base + '/api/backup', { headers: { Cookie: cookie } });
  assert.equal(backup.status, 200);
  const buf = Buffer.from(await backup.arrayBuffer());
  assert.equal(buf.subarray(0, 15).toString(), 'SQLite format 3');
});

test('deleting a patient removes their records', async () => {
  const p = (await call('POST', '/api/patients', { name: 'Temp' })).data;
  await call('POST', `/api/patients/${p.id}/visits`, { date: '2026-06-01', fee: 500 });
  assert.equal((await call('DELETE', `/api/patients/${p.id}`)).status, 200);
  assert.equal((await call('GET', `/api/patients/${p.id}`)).status, 404);
  const ar = (await call('GET', '/api/receivables?today=2026-06-30')).data;
  assert.ok(!ar.rows.some((r) => r.patient_id === p.id));
});

test('serves the app shell and blocks path traversal', async () => {
  const res = await fetch(base + '/patients/anything');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<main id="view"/);
  const bad = await fetch(base + '/..%2fserver.js');
  assert.notEqual(bad.status, 200);
});
