'use strict';

/* ======================================================================
   Dental clinic app — single-page front end (no build step).
   Routes live in the hash: #/patients/12, #/dues, ...
   ====================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = $('#view');

const state = { settings: {}, patientFilter: 'all', patientQuery: '', apptDate: null, duesSort: 'amount', patientTab: 'history' };

const TREATMENTS = [
  'Consultation', 'Scaling & Polishing', 'Filling', 'Root Canal (RCT)', 'Extraction', 'Crown', 'Bridge',
  'Denture', 'Implant', 'Braces / Ortho', 'X-Ray (IOPA)', 'OPG', 'Teeth Whitening', 'Dressing', 'Medication',
];
const PAY_METHODS = ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Cheque', 'Other'];

/* ---------------- icons ---------------- */
const ICON = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  wa: '<path d="M3 21l1.7-5A8.5 8.5 0 1 1 8 19.4z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a4 4 0 0 1-2-2l.8-1-1-2z"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/>',
  userPlus: '<circle cx="10" cy="8" r="4"/><path d="M2 21c0-4 4-7 8-7 1.5 0 3 .4 4.2 1.1M19 14v6M16 17h6"/>',
  tooth: '<path d="M7 3c-2.5 0-4 2-4 4.5 0 3 1.5 4.5 2 7 .5 3 1 6.5 3 6.5s2-4 4-4 2 4 4 4 2.5-3.5 3-6.5c.5-2.5 2-4 2-7C21 5 19.5 3 17 3c-2 0-3 1-5 1S9 3 7 3z"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 10v4M18 10v4"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  calPlus: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  print: '<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2"/><rect x="6" y="14" width="12" height="7"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  sheet: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 9v12"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24">${ICON[name]}</svg>`;

/* ---------------- formatting ---------------- */
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function money(n) {
  const v = Number(n) || 0;
  const s = Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `${v < 0 ? '−' : ''}${state.settings.currency || '₹'}${s}`;
}
function todayStr() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function addDays(s, n) {
  const d = new Date(s + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function fmtDate(s, opts = {}) {
  if (!s) return '';
  const d = new Date(s.slice(0, 10) + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: opts.noYear ? undefined : 'numeric', weekday: opts.weekday ? 'short' : undefined });
}
function shortDate(s) {
  const [y, m, d] = s.slice(0, 10).split('-');
  return `${d}/${m}/${y.slice(2)}`;
}
function relDay(s) {
  const t = todayStr();
  if (s === t) return 'Today';
  if (s === addDays(t, 1)) return 'Tomorrow';
  if (s === addDays(t, -1)) return 'Yesterday';
  return fmtDate(s, { weekday: true });
}
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
function initials(name) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}
const pid = (id) => `P-${String(id).padStart(4, '0')}`;
function ageOf(p) {
  if (p.dob) {
    const b = new Date(p.dob), n = new Date();
    let a = n.getFullYear() - b.getFullYear();
    if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
    return a;
  }
  return p.age ?? null;
}
function waNumber(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = (state.settings.country_code || '91') + d;
  return d;
}
function waLink(phone, text) {
  const n = waNumber(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}
function contactButtons(phone, waText) {
  if (!phone) return '';
  const wa = waLink(phone, waText || '');
  return `<div class="pill-actions">
    <a href="tel:${esc(phone)}" target="_top" aria-label="Call">${icon('phone')}</a>
    ${wa ? `<a class="wa" href="${esc(wa)}" target="_blank" rel="noopener" aria-label="WhatsApp">${icon('wa')}</a>` : ''}
  </div>`;
}
function reminderText(name, amount) {
  return (state.settings.reminder_template || '')
    .replaceAll('{name}', name)
    .replaceAll('{amount}', money(amount))
    .replaceAll('{clinic}', state.settings.clinic_name || 'our clinic');
}
function apptText(a) {
  return `Hello ${a.patient_name}, this is a reminder of your dental appointment at ${state.settings.clinic_name || 'our clinic'} on ${fmtDate(a.date, { weekday: true })}${a.time ? ' at ' + fmtTime(a.time) : ''}. Please reply to confirm.`;
}

/* ---------------- api ---------------- */
// Every call goes to api() in Code.gs through google.script.run; data lives in the Google Sheet.
function api(method, url, body) {
  const full = `${url}${url.includes('?') ? '&' : '?'}today=${todayStr()}`;
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler((text) => {
        const res = JSON.parse(text);
        if (res.ok) resolve(res.data);
        else reject(new Error(res.error || `Request failed (${res.status})`));
      })
      .withFailureHandler((err) => reject(new Error((err && err.message) || 'Could not reach Google. Check your internet connection.')))
      .api(method, full, body === undefined ? null : body);
  });
}

/* ---------------- ui helpers ---------------- */
let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 4000 : 2200);
}

function setChrome({ title, back = false, nav = true, tab = null, actions = '' }) {
  $('#title').textContent = title;
  document.title = title === state.settings.clinic_name ? title : `${title} · ${state.settings.clinic_name || 'Dental Clinic'}`;
  $('#back-btn').hidden = !back;
  $('#tabbar').hidden = !nav;
  document.body.classList.toggle('no-nav', !nav);
  $('#top-actions').innerHTML = actions;
  $$('#tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
}

function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    out[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return out;
}

function bindSubmit(form, fn) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    if (btn) btn.disabled = true;
    try {
      await fn(formData(form));
    } catch (err) {
      toast(err.message, true);
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

function goBack(fallback) {
  if (history.length > 1 && state.navigated) history.back();
  else location.hash = fallback;
}

function chipGroup(name, options, selected) {
  return `<div class="chips" data-chipgroup="${name}">
    ${options.map((o) => `<button type="button" class="chip${o === selected ? ' on' : ''}" data-value="${esc(o)}">${esc(o)}</button>`).join('')}
  </div><input type="hidden" name="${name}" value="${esc(selected)}">`;
}
function wireChipGroups(root) {
  $$('[data-chipgroup]', root).forEach((g) => {
    const input = g.nextElementSibling;
    g.addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      $$('.chip', g).forEach((c) => c.classList.toggle('on', c === b));
      input.value = b.dataset.value;
    });
  });
}

/** In-app replacement for confirm(); browser dialogs can be blocked inside Apps Script pages. */
function askConfirm(message, { ok = 'Delete', danger = true, cancel = 'Cancel' } = {}) {
  const m = $('#modal');
  m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">
    <p>${esc(message)}</p>
    <div class="btn-row"><button class="btn secondary" data-a="no">${esc(cancel)}</button><button class="btn ${danger ? 'danger-solid' : ''}" data-a="yes">${esc(ok)}</button></div>
  </div>`;
  m.hidden = false;
  return new Promise((resolve) => {
    m.onclick = (e) => {
      const b = e.target.closest('[data-a]');
      if (!b && e.target !== m) return;
      m.hidden = true;
      m.onclick = null;
      resolve(!!b && b.dataset.a === 'yes');
    };
  });
}

/** Runs an action from a button, showing any error as a toast. */
async function act(fn) {
  try { await fn(); } catch (e) { toast(e.message, true); }
}

const spinner = () => { view.innerHTML = '<div class="spinner"></div>'; };

/* ---------------- router ---------------- */
const routes = [];
const on = (pattern, fn) => routes.push([pattern, fn]);

async function router() {
  const raw = location.hash.slice(1) || '/';
  const [path, qs] = raw.split('?');
  const query = new URLSearchParams(qs || '');
  for (const [pattern, fn] of routes) {
    const m = path.match(pattern);
    if (m) {
      window.scrollTo(0, 0);
      try {
        await fn(query, ...m.slice(1));
      } catch (err) {
        view.innerHTML = `<div class="card empty">${esc(err.message)}</div>`;
      }
      return;
    }
  }
  location.hash = '#/';
}

/* ======================================================================
   Auth
   ====================================================================== */
const LOGO = '<svg class="logo" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#0f766e" stroke="none"/><path d="M22 14c-5 0-8 4-8 9 0 6 3 9 4 14 1 6 2 13 6 13s4-8 8-8 4 8 8 8 5-7 6-13c1-5 4-8 4-14 0-5-3-9-8-9-4 0-6 2-10 2s-6-2-10-2z" fill="#fff" stroke="none"/></svg>';

on(/^\/welcome$/, async () => {
  const s = state.settings;
  setChrome({ title: s.clinic_name || 'Dental Clinic', nav: false });
  view.innerHTML = `<div class="auth">
    ${LOGO}
    <h2>Welcome!</h2>
    <p class="muted">Set up your clinic in 10 seconds. Everything you enter is saved in your Google Sheet.</p>
    <form class="form" id="f">
      <div class="field"><label>Clinic name</label><input name="clinic_name" value="${esc(s.clinic_name)}" required></div>
      <div class="field"><label>Doctor's name</label><input name="doctor_name" value="${esc(s.doctor_name)}" placeholder="Dr. ..."></div>
      <div class="field"><label>Clinic phone</label><input name="clinic_phone" type="tel" value="${esc(s.clinic_phone)}"></div>
      <button class="btn block" type="submit">Start</button>
    </form></div>`;
  bindSubmit($('#f'), async (d) => {
    state.settings = await api('PUT', '/api/settings', { ...d, setup_done: 'yes' });
    location.replace('#/');
  });
});

async function loadSettings() {
  state.settings = await api('GET', '/api/settings');
}

/* ======================================================================
   Home / dashboard
   ====================================================================== */
on(/^\/$/, async () => {
  setChrome({ title: state.settings.clinic_name || 'Dental Clinic', tab: 'home' });
  spinner();
  const d = await api('GET', '/api/dashboard');
  const hr = new Date().getHours();
  const greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const doc = state.settings.doctor_name ? `, ${state.settings.doctor_name}` : '';
  const upcoming = d.appointments_today.filter((a) => a.status === 'scheduled').length;

  view.innerHTML = `
    <div class="muted small" style="margin:2px 4px 10px">${greet}${esc(doc)} · ${fmtDate(d.today, { weekday: true })}</div>
    <div class="stats">
      <a class="stat accent" href="#/reports"><div class="label">Collected today</div><div class="value">${money(d.collected_today)}</div></a>
      <a class="stat ${d.outstanding > 0 ? 'danger' : ''}" href="#/dues"><div class="label">Total dues (${d.patients_with_dues})</div><div class="value">${money(d.outstanding)}</div></a>
      <a class="stat" href="#/reports"><div class="label">This month</div><div class="value">${money(d.collected_month)}</div></a>
      <a class="stat" href="#/patients"><div class="label">Patients</div><div class="value">${d.patients}</div></a>
    </div>

    <div class="quick">
      <a href="#/patients/new"><span class="ic">${icon('userPlus')}</span>New patient</a>
      <a href="#/pick?for=visit"><span class="ic">${icon('tooth')}</span>Add visit</a>
      <a href="#/pick?for=pay"><span class="ic">${icon('cash')}</span>Receive payment</a>
      <a href="#/appointments/new"><span class="ic">${icon('calPlus')}</span>Book appt.</a>
    </div>

    <div class="section-title"><span>Today's appointments ${upcoming ? `<span class="badge info">${upcoming}</span>` : ''}</span><a href="#/appointments">See all</a></div>
    ${apptList(d.appointments_today, { emptyText: 'No appointments today.' })}

    ${d.followups.length ? `
      <div class="section-title"><span>Follow-ups due this week</span></div>
      <div class="list">${d.followups.map((f) => `
        <div class="item" data-href="#/patients/${f.patient_id}">
          <div class="avatar">${esc(initials(f.patient_name))}</div>
          <div class="grow"><div class="title ellipsis">${esc(f.patient_name)}</div>
          <div class="sub ellipsis">${relDay(f.next_visit)}${f.treatment ? ' · ' + esc(f.treatment) : ''}</div></div>
          <a class="btn sm secondary" href="#/appointments/new?patient=${f.patient_id}&date=${f.next_visit}">Book</a>
        </div>`).join('')}</div>` : ''}

    <div class="section-title"><span>Recent treatments</span></div>
    ${d.recent_visits.length ? `<div class="list">${d.recent_visits.map((v) => `
      <a class="item" href="#/patients/${v.patient_id}">
        <div class="grow"><div class="title ellipsis">${esc(v.patient_name)}</div>
        <div class="sub ellipsis">${relDay(v.date)} · ${esc(v.treatment || 'Visit')}</div></div>
        ${v.fee ? `<div class="nowrap">${money(v.fee)}</div>` : ''}
      </a>`).join('')}</div>` : `<div class="card empty">No treatments yet. Add your first patient to get started.</div>`}
  `;
  bindApptActions(view);
});

function apptList(list, { emptyText, showDate = false }) {
  if (!list.length) return `<div class="card empty">${emptyText}</div>`;
  return `<div class="list">${list.map((a) => `
    <div class="item status-${a.status}">
      <div class="time">${a.time ? fmtTime(a.time) : '—'}</div>
      <a class="grow" href="#/patients/${a.patient_id}" style="color:inherit">
        <div class="title ellipsis">${esc(a.patient_name)}</div>
        <div class="sub ellipsis">${showDate ? relDay(a.date) + ' · ' : ''}${esc(a.purpose || 'Appointment')}${a.status !== 'scheduled' ? ` · <b>${esc(a.status)}</b>` : ''}</div>
      </a>
      ${a.status === 'scheduled' ? `
        <div class="pill-actions">
          ${a.patient_phone ? `<a class="wa" href="${esc(waLink(a.patient_phone, apptText(a)) || '#')}" target="_blank" rel="noopener" aria-label="Send reminder">${icon('wa')}</a>` : ''}
          <button data-appt-done="${a.id}" data-pid="${a.patient_id}" aria-label="Mark done">${icon('check')}</button>
          <a href="#/appointments/${a.id}" aria-label="Edit">${icon('edit')}</a>
        </div>` : `<div class="pill-actions"><a href="#/appointments/${a.id}" aria-label="Edit">${icon('edit')}</a></div>`}
    </div>`).join('')}</div>`;
}

function bindApptActions(root) {
  $$('[data-appt-done]', root).forEach((b) => b.addEventListener('click', async () => {
    try {
      await api('PUT', `/api/appointments/${b.dataset.apptDone}`, { status: 'done' });
      toast('Marked as done — add the treatment notes');
      location.hash = `#/patients/${b.dataset.pid}/visits/new`;
    } catch (e) { toast(e.message, true); }
  }));
}

/* ---------------- quick-pick a patient (for Add visit / Receive payment) ---------------- */
on(/^\/pick$/, async (q) => {
  const purpose = q.get('for');
  setChrome({ title: purpose === 'pay' ? 'Receive payment — choose patient' : 'Add visit — choose patient', back: true, nav: false });
  view.innerHTML = `<div class="field"><input id="pq" type="search" placeholder="Search name, phone or P-number" autofocus></div><div id="pr"></div>
    <a class="btn secondary block mt" href="#/patients/new">${icon('userPlus')} New patient</a>`;
  patientPicker($('#pq'), $('#pr'), (p) => {
    location.replace(`#/patients/${p.id}/${purpose === 'pay' ? 'payments/new' : 'visits/new'}`);
  }, { showRecent: true });
});

function patientPicker(input, results, onPick, { showRecent = false } = {}) {
  let timer, seq = 0;
  const run = async () => {
    const q = input.value.trim();
    if (!q && !showRecent) { results.innerHTML = ''; return; }
    const my = ++seq;
    const list = await api('GET', `/api/patients?q=${encodeURIComponent(q)}`);
    if (my !== seq) return;
    const shown = list.slice(0, 30);
    results.innerHTML = shown.length ? `<div class="list results">${shown.map((p) => `
      <button type="button" class="item" style="width:100%;border-left:0;border-right:0;border-top:0;background:none;font:inherit;text-align:left;cursor:pointer" data-id="${p.id}">
        <div class="avatar">${esc(initials(p.name))}</div>
        <div class="grow"><div class="title ellipsis">${esc(p.name)}</div><div class="sub">${pid(p.id)}${p.phone ? ' · ' + esc(p.phone) : ''}</div></div>
        ${p.balance > 0 ? `<span class="badge due">${money(p.balance)}</span>` : ''}
      </button>`).join('')}</div>` : `<div class="empty">No patient found.</div>`;
    $$('[data-id]', results).forEach((b) => b.addEventListener('click', () => onPick(shown.find((p) => p.id === Number(b.dataset.id)))));
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 200); });
  run();
}

/* ======================================================================
   Patients
   ====================================================================== */
on(/^\/patients$/, async () => {
  setChrome({ title: 'Patients', tab: 'patients' });
  view.innerHTML = `
    <div class="search">
      <input id="q" type="search" placeholder="Search name, phone or P-number" value="${esc(state.patientQuery)}" autocomplete="off">
      <div class="chips mt" id="pf">
        <button class="chip${state.patientFilter === 'all' ? ' on' : ''}" data-f="all">All</button>
        <button class="chip${state.patientFilter === 'due' ? ' on' : ''}" data-f="due">With dues</button>
      </div>
    </div>
    <div id="plist"><div class="spinner"></div></div>
    <a class="fab" href="#/patients/new" aria-label="New patient">${icon('plus')}</a>`;
  let timer, seq = 0;
  const load = async () => {
    const my = ++seq;
    const list = await api('GET', `/api/patients?q=${encodeURIComponent(state.patientQuery)}&filter=${state.patientFilter}`);
    if (my !== seq) return;
    $('#plist').innerHTML = list.length ? `
      <div class="muted small" style="margin:0 4px 6px">${list.length} patient${list.length === 1 ? '' : 's'}</div>
      <div class="list">${list.map((p) => `
        <a class="item" href="#/patients/${p.id}">
          <div class="avatar">${esc(initials(p.name))}</div>
          <div class="grow">
            <div class="title ellipsis">${esc(p.name)}</div>
            <div class="sub ellipsis">${pid(p.id)}${p.phone ? ' · ' + esc(p.phone) : ''}${p.last_visit ? ' · Last: ' + fmtDate(p.last_visit, { noYear: true }) : ''}</div>
          </div>
          ${p.balance > 0 ? `<span class="badge due">${money(p.balance)}</span>` : ''}
        </a>`).join('')}</div>`
      : `<div class="card empty">${state.patientQuery || state.patientFilter === 'due' ? 'No matching patients.' : 'No patients yet.<br><br><a class="btn" href="#/patients/new">Add your first patient</a>'}</div>`;
  };
  $('#q').addEventListener('input', (e) => {
    state.patientQuery = e.target.value.trim();
    clearTimeout(timer);
    timer = setTimeout(load, 200);
  });
  $('#pf').addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    state.patientFilter = b.dataset.f;
    $$('#pf .chip').forEach((c) => c.classList.toggle('on', c === b));
    load();
  });
  load();
});

function patientForm(p = {}) {
  return `<form class="form" id="f">
    <div class="field"><label>Full name *</label><input name="name" value="${esc(p.name)}" required autocomplete="off" autocapitalize="words"></div>
    <div class="field"><label>Mobile number</label><input name="phone" type="tel" inputmode="tel" value="${esc(p.phone)}" autocomplete="off"></div>
    <div class="grid2">
      <div class="field"><label>Age</label><input name="age" type="number" inputmode="numeric" min="0" max="130" value="${esc(p.age)}"></div>
      <div class="field"><label>Gender</label>
        <select name="gender">${['', 'Female', 'Male', 'Other'].map((g) => `<option${(p.gender || '') === g ? ' selected' : ''} value="${g}">${g || '—'}</option>`).join('')}</select>
      </div>
    </div>
    <div class="field"><label>Date of birth <span class="muted small">(optional)</span></label><input name="dob" type="date" value="${esc(p.dob)}"></div>
    <div class="field"><label>Allergies</label><input name="allergies" value="${esc(p.allergies)}" placeholder="e.g. Penicillin, Latex"></div>
    <div class="field"><label>Medical history</label><textarea name="medical_history" placeholder="Diabetes, BP, heart condition, pregnancy, medicines...">${esc(p.medical_history)}</textarea></div>
    <div class="field"><label>Address</label><input name="address" value="${esc(p.address)}"></div>
    <div class="field"><label>Email</label><input name="email" type="email" value="${esc(p.email)}"></div>
    <div class="field"><label>Notes</label><textarea name="notes">${esc(p.notes)}</textarea></div>
    <button class="btn block" type="submit">Save patient</button>
  </form>`;
}

on(/^\/patients\/new$/, async () => {
  setChrome({ title: 'New patient', back: true, nav: false });
  view.innerHTML = patientForm();
  bindSubmit($('#f'), async (d) => {
    const p = await api('POST', '/api/patients', d);
    toast('Patient saved');
    location.replace(`#/patients/${p.id}`);
  });
});

on(/^\/patients\/(\d+)\/edit$/, async (_q, id) => {
  setChrome({ title: 'Edit patient', back: true, nav: false });
  spinner();
  const { patient } = await api('GET', `/api/patients/${id}`);
  view.innerHTML = patientForm(patient) + `<button class="btn danger block mt" id="del">${icon('trash')} Delete patient</button>`;
  bindSubmit($('#f'), async (d) => {
    await api('PUT', `/api/patients/${id}`, d);
    toast('Saved');
    goBack(`#/patients/${id}`);
  });
  $('#del').addEventListener('click', () => act(async () => {
    if (!await askConfirm(`Delete ${patient.name} and ALL their visits, payments and appointments? This cannot be undone.`)) return;
    await api('DELETE', `/api/patients/${id}`);
    toast('Patient deleted');
    location.replace('#/patients');
  }));
});

on(/^\/patients\/(\d+)$/, async (_q, id) => {
  setChrome({ title: 'Patient', back: true, tab: 'patients', actions: `<a class="icon-btn" href="#/patients/${id}/edit" aria-label="Edit patient">${icon('edit')}</a>` });
  spinner();
  const { patient: p, account, visits, payments, appointments } = await api('GET', `/api/patients/${id}`);
  setChrome({ title: p.name, back: true, tab: 'patients', actions: `<a class="icon-btn" href="#/patients/${id}/edit" aria-label="Edit patient">${icon('edit')}</a>` });
  const age = ageOf(p);
  const due = account.balance;
  const upcoming = appointments.filter((a) => a.status === 'scheduled' && a.date >= todayStr()).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));

  view.innerHTML = `
    <div class="card">
      <div class="phead">
        <div class="avatar">${esc(initials(p.name))}</div>
        <div class="grow">
          <h2 class="ellipsis">${esc(p.name)}</h2>
          <div class="muted small">${pid(p.id)}${age !== null ? ` · ${age} yrs` : ''}${p.gender ? ` · ${esc(p.gender)}` : ''}</div>
          ${p.phone ? `<div class="small">${esc(p.phone)}</div>` : ''}
        </div>
        ${contactButtons(p.phone, `Hello ${p.name}, `)}
      </div>
      ${p.allergies ? `<div class="alert">${icon('alert')}<div>Allergies: ${esc(p.allergies)}</div></div>` : ''}
      ${upcoming.length ? `<a class="alert" style="background:var(--primary-soft);color:var(--primary)" href="#/appointments/${upcoming[0].id}">${icon('cal')}<div>Next appointment: ${relDay(upcoming[0].date)}${upcoming[0].time ? ' at ' + fmtTime(upcoming[0].time) : ''}</div></a>` : ''}
    </div>

    <div class="card">
      <div class="account">
        <div><div class="v">${money(account.billed)}</div><div class="l">Billed</div></div>
        <div><div class="v" style="color:var(--ok)">${money(account.paid)}</div><div class="l">Paid</div></div>
        <div><div class="v" style="color:${due > 0 ? 'var(--danger)' : 'var(--ok)'}">${money(Math.abs(due))}</div><div class="l">${due < 0 ? 'Advance' : 'Due'}</div></div>
      </div>
      <div class="btn-row">
        <a class="btn" href="#/patients/${id}/visits/new">${icon('tooth')} Add visit</a>
        <a class="btn secondary" href="#/patients/${id}/payments/new">${icon('cash')} Payment</a>
      </div>
      <div class="btn-row mt">
        <a class="btn secondary sm" href="#/appointments/new?patient=${id}">${icon('calPlus')} Book</a>
        <a class="btn secondary sm" href="#/patients/${id}/statement">${icon('file')} Statement</a>
        ${due > 0 && p.phone ? `<a class="btn secondary sm" href="${esc(waLink(p.phone, reminderText(p.name, due)))}" target="_blank" rel="noopener">${icon('wa')} Remind</a>` : ''}
      </div>
    </div>

    <div class="tabs" id="ptabs">
      <button data-t="history">History (${visits.length + payments.length})</button>
      <button data-t="info">Medical info</button>
      <button data-t="appts">Appts (${appointments.length})</button>
    </div>
    <div id="ptab"></div>`;

  const tabs = {
    history: () => {
      const items = [
        ...visits.map((v) => ({ kind: 'visit', date: v.date, key: v.created_at, v })),
        ...payments.map((x) => ({ kind: 'pay', date: x.date, key: x.created_at, x })),
      ].sort((a, b) => b.date.localeCompare(a.date) || b.key.localeCompare(a.key));
      if (!items.length) return `<div class="card empty">No visits yet.<br><br><a class="btn" href="#/patients/${id}/visits/new">Add first visit</a></div>`;
      return `<div class="tl">${items.map((it) => it.kind === 'visit' ? `
        <div class="tl-item"><a class="card" style="display:block;color:inherit" href="#/patients/${id}/visits/${it.v.id}">
          <div class="row"><div class="grow"><b>${esc(it.v.treatment || 'Visit')}</b><div class="muted small">${fmtDate(it.v.date, { weekday: true })}</div></div>
          ${it.v.fee ? `<span class="badge grey">${money(it.v.fee)}</span>` : ''}</div>
          <dl class="kv">
            ${it.v.teeth ? `<dt>Teeth</dt><dd>${esc(it.v.teeth)}</dd>` : ''}
            ${it.v.complaint ? `<dt>Complaint</dt><dd>${esc(it.v.complaint)}</dd>` : ''}
            ${it.v.diagnosis ? `<dt>Diagnosis</dt><dd>${esc(it.v.diagnosis)}</dd>` : ''}
            ${it.v.notes ? `<dt>Notes</dt><dd>${esc(it.v.notes)}</dd>` : ''}
            ${it.v.next_visit ? `<dt>Next visit</dt><dd>${fmtDate(it.v.next_visit)}</dd>` : ''}
          </dl></a></div>` : `
        <div class="tl-item pay"><a class="card" style="display:block;color:inherit" href="#/patients/${id}/payments/${it.x.id}">
          <div class="row"><div class="grow"><b style="color:var(--ok)">Payment received</b><div class="muted small">${fmtDate(it.x.date, { weekday: true })} · ${esc(it.x.method)}${it.x.note ? ' · ' + esc(it.x.note) : ''}</div></div>
          <span class="badge ok">${money(it.x.amount)}</span></div></a></div>`).join('')}</div>`;
    },
    info: () => `<div class="card"><dl class="kv" style="margin:0">
        <dt>Allergies</dt><dd>${esc(p.allergies) || '<span class="muted">None recorded</span>'}</dd>
        <dt>Medical</dt><dd>${esc(p.medical_history) || '<span class="muted">None recorded</span>'}</dd>
        <dt>DOB</dt><dd>${p.dob ? fmtDate(p.dob) : '—'}</dd>
        <dt>Address</dt><dd>${esc(p.address) || '—'}</dd>
        <dt>Email</dt><dd>${esc(p.email) || '—'}</dd>
        <dt>Notes</dt><dd>${esc(p.notes) || '—'}</dd>
        <dt>Registered</dt><dd>${fmtDate(p.created_at)}</dd>
      </dl><a class="btn secondary block mt" href="#/patients/${id}/edit">${icon('edit')} Edit details</a></div>`,
    appts: () => `${apptList(appointments.map((a) => ({ ...a, patient_name: p.name, patient_phone: p.phone })), { emptyText: 'No appointments.', showDate: true })}
      <a class="btn secondary block mt" href="#/appointments/new?patient=${id}">${icon('calPlus')} Book appointment</a>`,
  };
  const show = (t) => {
    state.patientTab = t;
    $$('#ptabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    $('#ptab').innerHTML = tabs[t]();
    bindApptActions($('#ptab'));
  };
  $('#ptabs').addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b) show(b.dataset.t); });
  show(tabs[state.patientTab] ? state.patientTab : 'history');
});

/* ---------------- visit form ---------------- */
const UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

function toothChart(selected) {
  const set = new Set(selected);
  const row = (nums) => nums.map((n) => `<button type="button" class="tooth${set.has(String(n)) ? ' on' : ''}" data-tooth="${n}">${n}</button>`).join('');
  return `<div class="teeth" id="teeth">
    <div class="cap"><span>Upper right</span><span>Upper left</span></div>
    <div class="jaw">${row(UPPER)}</div>
    <div class="jaw">${row(LOWER)}</div>
    <div class="cap" style="padding:4px 4px 0"><span>Lower right</span><span>Lower left</span></div>
  </div>`;
}

on(/^\/patients\/(\d+)\/visits\/(new|\d+)$/, async (_q, id, vid) => {
  const isNew = vid === 'new';
  setChrome({ title: isNew ? 'Add visit' : 'Edit visit', back: true, nav: false });
  spinner();
  const { patient: p, visits, account } = await api('GET', `/api/patients/${id}`);
  const v = isNew ? { date: todayStr() } : visits.find((x) => x.id === Number(vid));
  if (!v) throw new Error('Visit not found');
  const teeth = (v.teeth || '').split(/[,\s]+/).filter(Boolean);

  view.innerHTML = `
    <div class="row" style="margin:0 4px 12px"><div class="avatar">${esc(initials(p.name))}</div><div class="grow"><b>${esc(p.name)}</b><div class="muted small">${pid(p.id)}${account.balance > 0 ? ` · Previous due <b style="color:var(--danger)">${money(account.balance)}</b>` : ''}</div></div></div>
    ${p.allergies ? `<div class="alert" style="margin:0 0 12px">${icon('alert')}<div>Allergies: ${esc(p.allergies)}</div></div>` : ''}
    <form class="form" id="f">
      <div class="field"><label>Date</label><input name="date" type="date" value="${esc(v.date)}" required></div>
      <div class="field"><label>Chief complaint</label><input name="complaint" value="${esc(v.complaint)}" placeholder="e.g. Pain in lower left tooth"></div>
      <div class="field"><label>Teeth <span class="muted small">(tap to select)</span></label>
        ${toothChart(teeth)}
        <input name="teeth" class="mt" value="${esc(v.teeth)}" placeholder="or type, e.g. 36, 37">
      </div>
      <div class="field"><label>Diagnosis</label><input name="diagnosis" value="${esc(v.diagnosis)}"></div>
      <div class="field"><label>Treatment done</label>
        <div class="chips scroll" id="tx">${TREATMENTS.map((t) => `<button type="button" class="chip" data-tx="${esc(t)}">${esc(t)}</button>`).join('')}</div>
        <input name="treatment" class="mt" value="${esc(v.treatment)}" placeholder="e.g. RCT 36 – access opening">
      </div>
      <div class="field"><label>Notes / prescription</label><textarea name="notes">${esc(v.notes)}</textarea></div>
      <div class="field"><label>Fee charged</label><div class="money-input"><span>${esc(state.settings.currency || '₹')}</span><input name="fee" type="number" inputmode="decimal" min="0" step="0.01" value="${v.fee ? esc(v.fee) : ''}" placeholder="0"></div></div>
      ${isNew ? `
        <div class="card" style="background:var(--surface-2)">
          <div class="field"><label>Paid now</label><div class="money-input"><span>${esc(state.settings.currency || '₹')}</span><input name="paid_now" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0"></div>
          <button type="button" class="btn ghost sm" id="payfull" style="padding-left:0">Paid in full</button></div>
          <div class="field" style="margin:0"><label>Payment mode</label>${chipGroup('paid_method', PAY_METHODS, 'Cash')}</div>
        </div>` : ''}
      <div class="field"><label>Next visit</label>
        <div class="chips" id="nv">${[['+3 days', 3], ['+1 week', 7], ['+2 weeks', 14], ['+1 month', 30], ['+6 months', 182]].map(([l, n]) => `<button type="button" class="chip" data-days="${n}">${l}</button>`).join('')}</div>
        <input name="next_visit" type="date" class="mt" value="${esc(v.next_visit)}">
        ${isNew ? '<label class="check mt"><input type="checkbox" name="book_next" checked> Also book an appointment</label>' : ''}
      </div>
      <button class="btn block" type="submit">Save visit</button>
    </form>
    ${isNew ? '' : `<button class="btn danger block mt" id="del">${icon('trash')} Delete visit</button>`}`;

  const form = $('#f');
  wireChipGroups(form);
  const teethInput = form.elements.teeth;
  $('#teeth').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tooth]');
    if (!b) return;
    b.classList.toggle('on');
    const typed = teethInput.value.split(/[,\s]+/).filter(Boolean).filter((t) => !/^[1-4][1-8]$/.test(t));
    const picked = $$('.tooth.on', $('#teeth')).map((x) => x.dataset.tooth);
    teethInput.value = [...picked, ...typed].join(', ');
  });
  teethInput.addEventListener('input', () => {
    const set = new Set(teethInput.value.split(/[,\s]+/));
    $$('.tooth', $('#teeth')).forEach((b) => b.classList.toggle('on', set.has(b.dataset.tooth)));
  });
  $('#tx').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tx]');
    if (!b) return;
    const cur = form.elements.treatment.value.trim();
    form.elements.treatment.value = cur ? `${cur}, ${b.dataset.tx}` : b.dataset.tx;
  });
  $('#nv').addEventListener('click', (e) => {
    const b = e.target.closest('[data-days]');
    if (!b) return;
    form.elements.next_visit.value = addDays(form.elements.date.value || todayStr(), Number(b.dataset.days));
  });
  if (isNew) {
    $('#payfull').addEventListener('click', () => {
      const fee = Number(form.elements.fee.value) || 0;
      form.elements.paid_now.value = Math.max(fee + Math.max(account.balance, 0), 0) || '';
    });
  }
  bindSubmit(form, async (d) => {
    if (isNew) await api('POST', `/api/patients/${id}/visits`, d);
    else await api('PUT', `/api/visits/${vid}`, d);
    toast('Visit saved');
    location.replace(`#/patients/${id}`);
  });
  if (!isNew) {
    $('#del').addEventListener('click', () => act(async () => {
      if (!await askConfirm('Delete this visit? Its fee will be removed from the bill.')) return;
      await api('DELETE', `/api/visits/${vid}`);
      toast('Visit deleted');
      location.replace(`#/patients/${id}`);
    }));
  }
});

/* ---------------- payment form ---------------- */
on(/^\/patients\/(\d+)\/payments\/(new|\d+)$/, async (_q, id, payId) => {
  const isNew = payId === 'new';
  setChrome({ title: isNew ? 'Receive payment' : 'Edit payment', back: true, nav: false });
  spinner();
  const { patient: p, payments, account } = await api('GET', `/api/patients/${id}`);
  const x = isNew ? { date: todayStr(), method: 'Cash' } : payments.find((y) => y.id === Number(payId));
  if (!x) throw new Error('Payment not found');

  view.innerHTML = `
    <div class="card row">
      <div class="avatar">${esc(initials(p.name))}</div>
      <div class="grow"><b>${esc(p.name)}</b><div class="muted small">${pid(p.id)}</div></div>
      <div class="right"><div class="muted small">${account.balance < 0 ? 'Advance' : 'Due'}</div><b style="color:${account.balance > 0 ? 'var(--danger)' : 'var(--ok)'};font-size:18px">${money(Math.abs(account.balance))}</b></div>
    </div>
    <form class="form" id="f">
      <div class="field"><label>Amount received *</label>
        <div class="money-input"><span>${esc(state.settings.currency || '₹')}</span><input name="amount" type="number" inputmode="decimal" min="0.01" step="0.01" required value="${isNew ? '' : esc(x.amount)}" autofocus style="font-size:22px"></div>
        ${isNew && account.balance > 0 ? `<button type="button" class="btn ghost sm" id="full" style="padding-left:0">Full due: ${money(account.balance)}</button>` : ''}
      </div>
      <div class="field"><label>Mode</label>${chipGroup('method', PAY_METHODS, x.method)}</div>
      <div class="field"><label>Date</label><input name="date" type="date" value="${esc(x.date)}" required></div>
      <div class="field"><label>Note</label><input name="note" value="${esc(x.note)}" placeholder="e.g. UPI ref no., advance for crown"></div>
      <button class="btn block" type="submit">${isNew ? 'Save payment' : 'Save changes'}</button>
    </form>
    ${isNew ? '' : `<button class="btn danger block mt" id="del">${icon('trash')} Delete payment</button>`}`;
  const form = $('#f');
  wireChipGroups(form);
  $('#full')?.addEventListener('click', () => { form.elements.amount.value = account.balance; });
  bindSubmit(form, async (d) => {
    if (isNew) await api('POST', `/api/patients/${id}/payments`, d);
    else await api('PUT', `/api/payments/${payId}`, d);
    toast(`Payment of ${money(d.amount)} saved`);
    location.replace(`#/patients/${id}`);
  });
  $('#del')?.addEventListener('click', () => act(async () => {
    if (!await askConfirm('Delete this payment?')) return;
    await api('DELETE', `/api/payments/${payId}`);
    toast('Payment deleted');
    location.replace(`#/patients/${id}`);
  }));
});

/* ---------------- statement (printable) ---------------- */
on(/^\/patients\/(\d+)\/statement$/, async (_q, id) => {
  setChrome({ title: 'Statement', back: true, nav: false, actions: `<button class="icon-btn" onclick="window.print()" aria-label="Print">${icon('print')}</button>` });
  spinner();
  const { patient: p, visits, payments, account } = await api('GET', `/api/patients/${id}`);
  const s = state.settings;
  const rows = [
    ...visits.filter((v) => v.fee > 0).map((v) => ({ date: v.date, key: v.created_at, desc: [v.treatment || 'Treatment', v.teeth ? `(${v.teeth})` : ''].join(' '), charge: v.fee, paid: 0 })),
    ...payments.map((x) => ({ date: x.date, key: x.created_at, desc: `Payment – ${x.method}${x.note ? ' – ' + x.note : ''}`, charge: 0, paid: x.amount })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  let run = 0;
  view.innerHTML = `
    <div class="statement">
      <div class="row" style="align-items:flex-start">
        <div class="grow">
          <h2>${esc(s.clinic_name)}</h2>
          ${s.doctor_name ? `<div>${esc(s.doctor_name)}</div>` : ''}
          <div class="muted small pre">${esc([s.clinic_address, s.clinic_phone].filter(Boolean).join('\n'))}</div>
        </div>
        <div class="right small"><b>Statement of account</b><br>${fmtDate(todayStr())}</div>
      </div>
      <hr>
      <div><b>${esc(p.name)}</b> <span class="muted">(${pid(p.id)})</span>${p.phone ? `<br><span class="muted small">${esc(p.phone)}</span>` : ''}</div>
      <div class="table-wrap mt"><table class="tbl">
        <thead><tr><th>Date</th><th>Details</th><th class="num">Charge</th><th class="num">Paid</th><th class="num">Bal.</th></tr></thead>
        <tbody>${rows.length ? rows.map((r) => { run += r.charge - r.paid; return `<tr><td class="nowrap">${shortDate(r.date)}</td><td>${esc(r.desc)}</td><td class="num">${r.charge ? money(r.charge) : ''}</td><td class="num">${r.paid ? money(r.paid) : ''}</td><td class="num">${money(run)}</td></tr>`; }).join('') : '<tr><td colspan="5" class="center muted">No transactions</td></tr>'}</tbody>
        <tfoot><tr><th colspan="2">Total</th><th class="num">${money(account.billed)}</th><th class="num">${money(account.paid)}</th><th class="num">${money(account.balance)}</th></tr></tfoot>
      </table></div>
      <hr>
      <div class="right" style="font-size:18px"><b>${account.balance < 0 ? 'Advance with clinic' : 'Amount due'}: ${money(Math.abs(account.balance))}</b></div>
    </div>
    <div class="btn-row mt no-print">
      <button class="btn" onclick="window.print()">${icon('print')} Print / Save PDF</button>
      ${p.phone && account.balance > 0 ? `<a class="btn secondary" href="${esc(waLink(p.phone, reminderText(p.name, account.balance)))}" target="_blank" rel="noopener">${icon('wa')} WhatsApp</a>` : ''}
    </div>`;
});

/* ======================================================================
   Appointments
   ====================================================================== */
on(/^\/appointments$/, async () => {
  setChrome({ title: 'Appointments', tab: 'appointments' });
  const t = todayStr();
  if (!state.apptDate) state.apptDate = t;
  const sel = state.apptDate;
  const start = addDays(sel, -3);
  const days = Array.from({ length: 21 }, (_, i) => addDays(start, i));
  view.innerHTML = `
    <div class="row" style="margin-bottom:10px">
      <button class="btn secondary sm" id="prev" aria-label="Previous week">‹</button>
      <input type="date" id="pickdate" value="${sel}" class="grow" style="min-height:38px;padding:6px 10px">
      <button class="btn secondary sm" id="next" aria-label="Next week">›</button>
      ${sel !== t ? '<button class="btn ghost sm" id="today">Today</button>' : ''}
    </div>
    <div class="datestrip" id="strip">${days.map((d) => {
      const dt = new Date(d + 'T00:00:00');
      return `<button data-d="${d}" class="${d === sel ? 'on' : ''} ${d === t ? 'today' : ''}"><span class="w">${dt.toLocaleDateString('en-IN', { weekday: 'short' })}</span><span class="d">${dt.getDate()}</span></button>`;
    }).join('')}</div>
    <div class="section-title"><span>${relDay(sel)}</span></div>
    <div id="alist"><div class="spinner"></div></div>
    <a class="fab" href="#/appointments/new?date=${sel}" aria-label="New appointment">${icon('plus')}</a>`;
  const go = (d) => { state.apptDate = d; router(); };
  $('#strip').addEventListener('click', (e) => { const b = e.target.closest('[data-d]'); if (b) go(b.dataset.d); });
  $('#prev').addEventListener('click', () => go(addDays(sel, -7)));
  $('#next').addEventListener('click', () => go(addDays(sel, 7)));
  $('#today')?.addEventListener('click', () => go(t));
  $('#pickdate').addEventListener('change', (e) => e.target.value && go(e.target.value));
  $('#strip .on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  const list = await api('GET', `/api/appointments?from=${sel}&to=${sel}`);
  $('#alist').innerHTML = apptList(list, { emptyText: `No appointments.<br><br><a class="btn" href="#/appointments/new?date=${sel}">Book one</a>` });
  bindApptActions($('#alist'));
});

on(/^\/appointments\/(new|\d+)$/, async (q, aid) => {
  const isNew = aid === 'new';
  setChrome({ title: isNew ? 'Book appointment' : 'Edit appointment', back: true, nav: false });
  let a = { date: q.get('date') || state.apptDate || todayStr(), time: '', purpose: '', status: 'scheduled', patient_id: q.get('patient') ? Number(q.get('patient')) : null };
  let patient = null;
  if (!isNew) {
    const found = await findAppointment(Number(aid));
    if (!found) throw new Error('Appointment not found');
    a = found.appt;
    patient = found.patient;
  } else if (a.patient_id) {
    patient = (await api('GET', `/api/patients/${a.patient_id}`)).patient;
  }

  view.innerHTML = `<form class="form" id="f">
    <div class="field"><label>Patient *</label><div id="pp"></div></div>
    <div class="grid2">
      <div class="field"><label>Date</label><input name="date" type="date" value="${esc(a.date)}" required></div>
      <div class="field"><label>Time</label><input name="time" type="time" value="${esc(a.time)}" step="300"></div>
    </div>
    <div class="field"><div class="chips" id="slots">${['09:30', '10:30', '11:30', '12:30', '16:00', '17:00', '18:00', '19:00'].map((s) => `<button type="button" class="chip" data-slot="${s}">${fmtTime(s)}</button>`).join('')}</div></div>
    <div class="field"><label>Purpose</label><input name="purpose" value="${esc(a.purpose)}" placeholder="e.g. RCT 2nd sitting" list="tx-list">
      <datalist id="tx-list">${TREATMENTS.map((t) => `<option value="${esc(t)}">`).join('')}</datalist></div>
    ${isNew ? '' : `<div class="field"><label>Status</label>${chipGroup('status', ['scheduled', 'done', 'cancelled', 'no-show'], a.status)}</div>`}
    <button class="btn block" type="submit">${isNew ? 'Book appointment' : 'Save'}</button>
  </form>
  ${isNew ? '' : `<button class="btn danger block mt" id="del">${icon('trash')} Delete appointment</button>`}`;
  const form = $('#f');
  wireChipGroups(form);

  const renderPicked = () => {
    const box = $('#pp');
    if (patient) {
      box.innerHTML = `<div class="picked"><div class="avatar">${esc(initials(patient.name))}</div><div class="grow"><b>${esc(patient.name)}</b><div class="small muted">${pid(patient.id)}${patient.phone ? ' · ' + esc(patient.phone) : ''}</div></div>${isNew ? '<button type="button" class="btn ghost sm" id="chg">Change</button>' : ''}</div>`;
      $('#chg')?.addEventListener('click', () => { patient = null; renderPicked(); });
    } else {
      box.innerHTML = `<input id="pq" type="search" placeholder="Search patient by name or phone" autocomplete="off"><div id="pr"></div>
        <a class="btn ghost sm" href="#/patients/new">+ New patient</a>`;
      patientPicker($('#pq'), $('#pr'), (p) => { patient = p; renderPicked(); });
      $('#pq').focus();
    }
  };
  renderPicked();
  $('#slots').addEventListener('click', (e) => { const b = e.target.closest('[data-slot]'); if (b) form.elements.time.value = b.dataset.slot; });

  bindSubmit(form, async (d) => {
    if (!patient) throw new Error('Please choose a patient');
    d.patient_id = patient.id;
    if (isNew) await api('POST', '/api/appointments', d);
    else await api('PUT', `/api/appointments/${aid}`, d);
    state.apptDate = d.date;
    toast(isNew ? 'Appointment booked' : 'Saved');
    if (isNew && patient.phone && await askConfirm('Send a WhatsApp confirmation to the patient?', { ok: 'Send on WhatsApp', cancel: 'No', danger: false })) {
      window.open(waLink(patient.phone, apptText({ ...d, patient_name: patient.name })), '_blank', 'noopener');
    }
    goBack('#/appointments');
  });
  $('#del')?.addEventListener('click', () => act(async () => {
    if (!await askConfirm('Delete this appointment?')) return;
    await api('DELETE', `/api/appointments/${aid}`);
    toast('Deleted');
    goBack('#/appointments');
  }));
});

async function findAppointment(id) {
  const appt = await api('GET', `/api/appointments/${id}`);
  return { appt, patient: { id: appt.patient_id, name: appt.patient_name, phone: appt.patient_phone } };
}

/* ======================================================================
   Dues (accounts receivable)
   ====================================================================== */
on(/^\/dues$/, async () => {
  setChrome({ title: 'Dues (Receivables)', tab: 'dues', actions: `<button class="icon-btn" id="tosheet" aria-label="Save dues report to Google Sheet">${icon('sheet')}</button>` });
  $('#tosheet').addEventListener('click', saveDuesToSheet);
  spinner();
  const ar = await api('GET', '/api/receivables');
  const t = ar.totals;
  const pct = (v) => (t.balance ? (v / t.balance) * 100 : 0).toFixed(2);
  const sorters = {
    amount: (a, b) => b.balance - a.balance,
    oldest: (a, b) => b.days_overdue - a.days_overdue,
    name: (a, b) => a.name.localeCompare(b.name),
  };
  const render = () => {
    const rows = [...ar.rows].sort(sorters[state.duesSort]);
    $('#drows').innerHTML = rows.length ? `<div class="list">${rows.map((r) => {
      const sev = r.days_overdue > 90 ? 'due' : r.days_overdue > 30 ? 'warn' : 'grey';
      return `<div class="item" data-href="#/patients/${r.patient_id}">
        <div class="grow">
          <div class="title ellipsis">${esc(r.name)}</div>
          <div class="sub"><span class="badge ${sev}">${r.days_overdue} days</span> ${r.last_payment ? 'Last paid ' + fmtDate(r.last_payment, { noYear: true }) : 'No payment yet'}</div>
        </div>
        <div class="right"><div style="font-weight:750;color:var(--danger)" class="nowrap">${money(r.balance)}</div>
          <a class="btn sm ghost" style="min-height:28px;padding:0" href="#/patients/${r.patient_id}/payments/new">Receive</a></div>
        ${contactButtons(r.phone, reminderText(r.name, r.balance))}
      </div>`;
    }).join('')}</div>` : '<div class="card empty">🎉 No pending dues. All patients are paid up.</div>';
  };
  view.innerHTML = `
    <div class="card">
      <div class="muted small" style="font-weight:600">Total outstanding</div>
      <div style="font-size:30px;font-weight:800;color:${t.balance > 0 ? 'var(--danger)' : 'var(--ok)'}">${money(t.balance)}</div>
      <div class="muted small">${ar.rows.length} patient${ar.rows.length === 1 ? '' : 's'} with pending balance</div>
      ${t.balance > 0 ? `
        <div class="aging"><span class="a1" style="width:${pct(t.d0_30)}%"></span><span class="a2" style="width:${pct(t.d31_60)}%"></span><span class="a3" style="width:${pct(t.d61_90)}%"></span><span class="a4" style="width:${pct(t.d90_plus)}%"></span></div>
        <div class="legend">
          <div><i class="a1"></i>0–30 d: <b>${money(t.d0_30)}</b></div>
          <div><i class="a2"></i>31–60 d: <b>${money(t.d31_60)}</b></div>
          <div><i class="a3"></i>61–90 d: <b>${money(t.d61_90)}</b></div>
          <div><i class="a4"></i>90+ d: <b>${money(t.d90_plus)}</b></div>
        </div>` : ''}
    </div>
    <div class="row" style="margin:4px 4px 10px"><span class="muted small">Sort:</span>
      <div class="chips" id="ds">${[['amount', 'Highest'], ['oldest', 'Oldest'], ['name', 'Name']].map(([k, l]) => `<button class="chip${state.duesSort === k ? ' on' : ''}" data-s="${k}">${l}</button>`).join('')}</div>
    </div>
    <div id="drows"></div>
    ${ar.advances.length ? `<div class="section-title"><span>Advances held</span></div>
      <div class="list">${ar.advances.map((r) => `<a class="item" href="#/patients/${r.patient_id}"><div class="grow title">${esc(r.name)}</div><span class="badge ok">${money(r.credit)}</span></a>`).join('')}</div>` : ''}
    <p class="muted small center mt">Tap the WhatsApp icon to send a polite payment reminder.</p>`;
  $('#ds').addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    state.duesSort = b.dataset.s;
    $$('#ds .chip').forEach((c) => c.classList.toggle('on', c === b));
    render();
  });
  render();
});

/* ======================================================================
   More / reports / settings
   ====================================================================== */
async function saveDuesToSheet() {
  await act(async () => {
    toast('Saving dues report…');
    const r = await api('POST', '/api/receivables/sheet', {});
    toast(`Saved ${r.rows} patient${r.rows === 1 ? '' : 's'} to the “Dues Report” tab`);
  });
}

on(/^\/more$/, async () => {
  setChrome({ title: 'More', tab: 'more' });
  const link = (href, ic, title, sub, attrs = '') => `<a class="item" href="${href}" ${attrs}><div class="avatar">${icon(ic)}</div><div class="grow"><div class="title">${title}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${icon('chevron')}</a>`;
  view.innerHTML = `
    <div class="list">
      ${link('#/reports', 'chart', 'Reports', 'Collections, billing, payment modes')}
      ${link('#/settings', 'gear', 'Clinic settings', 'Name, address, currency, reminder message')}
    </div>
    <div class="section-title"><span>Your data (Google Sheets)</span></div>
    <div class="list">
      ${link(esc(state.settings.spreadsheet_url || '#'), 'sheet', 'Open the Google Sheet', 'All patients, visits, payments and appointments', 'target="_blank" rel="noopener"')}
      <button class="item" id="dues-sheet" style="width:100%;border-left:0;border-right:0;border-top:0;background:none;font:inherit;text-align:left;cursor:pointer"><div class="avatar">${icon('download')}</div><div class="grow"><div class="title">Save dues report to the sheet</div><div class="sub">Writes the current dues list into a “Dues Report” tab</div></div></button>
    </div>
    <p class="muted small center mt">Google keeps your data safe and keeps version history.<br>In the sheet use File → Download → Excel for an offline copy.</p>
    <p class="muted small center">Tip: open this app in Chrome/Safari and choose “Add to Home Screen” to open it like an app.</p>`;
  $('#dues-sheet').addEventListener('click', saveDuesToSheet);
});

on(/^\/reports$/, async (q) => {
  setChrome({ title: 'Reports', back: true, tab: 'more' });
  const t = todayStr();
  const monthStart = t.slice(0, 8) + '01';
  const lastMonthEnd = addDays(monthStart, -1);
  const presets = {
    today: [t, t],
    week: [addDays(t, -6), t],
    month: [monthStart, t],
    last_month: [lastMonthEnd.slice(0, 8) + '01', lastMonthEnd],
    year: [`${t.slice(0, 4)}-01-01`, t],
  };
  const preset = q.get('p') || (q.get('from') ? 'custom' : 'month');
  const [from, to] = presets[preset] || [q.get('from') || monthStart, q.get('to') || t];
  spinner();
  const r = await api('GET', `/api/reports?from=${from}&to=${to}`);
  view.innerHTML = `
    <div class="chips scroll" id="rp">${[['today', 'Today'], ['week', '7 days'], ['month', 'This month'], ['last_month', 'Last month'], ['year', 'This year']].map(([k, l]) => `<button class="chip${preset === k ? ' on' : ''}" data-p="${k}">${l}</button>`).join('')}</div>
    <form class="grid2 mt" id="rf" style="align-items:end">
      <div><label class="label-txt">From</label><input type="date" name="from" value="${from}"></div>
      <div><label class="label-txt">To</label><input type="date" name="to" value="${to}"></div>
    </form>
    <div class="stats mt">
      <div class="stat accent"><div class="label">Collected</div><div class="value">${money(r.collected)}</div></div>
      <div class="stat"><div class="label">Billed</div><div class="value">${money(r.billed)}</div></div>
      <div class="stat"><div class="label">Visits</div><div class="value">${r.visits}</div></div>
      <div class="stat"><div class="label">New patients</div><div class="value">${r.new_patients}</div></div>
    </div>
    <div class="card"><h2>By payment mode</h2>
      ${r.by_method.length ? `<table class="tbl">${r.by_method.map((m) => `<tr><td>${esc(m.method)} <span class="muted small">(${m.count})</span></td><td class="num"><b>${money(m.total)}</b></td></tr>`).join('')}</table>` : '<div class="muted">No payments in this period.</div>'}
    </div>
    ${r.top_treatments.length ? `<div class="card"><h2>Top treatments</h2><table class="tbl">
      <tr><th>Treatment</th><th class="num">Count</th><th class="num">Billed</th></tr>
      ${r.top_treatments.map((x) => `<tr><td>${esc(x.treatment)}</td><td class="num">${x.count}</td><td class="num">${money(x.total)}</td></tr>`).join('')}</table></div>` : ''}
    <div class="card"><h2>Day by day</h2>
      ${r.daily.length ? `<div class="table-wrap"><table class="tbl"><tr><th>Date</th><th class="num">Visits</th><th class="num">Billed</th><th class="num">Collected</th></tr>
      ${r.daily.map((d) => `<tr><td class="nowrap">${fmtDate(d.date, { weekday: true })}</td><td class="num">${d.visits}</td><td class="num">${money(d.billed)}</td><td class="num">${money(d.collected)}</td></tr>`).join('')}</table></div>` : '<div class="muted">Nothing recorded in this period.</div>'}
    </div>`;
  $('#rp').addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (b) location.replace(`#/reports?p=${b.dataset.p}`); });
  $('#rf').addEventListener('change', () => {
    const d = formData($('#rf'));
    if (d.from && d.to) location.replace(`#/reports?from=${d.from}&to=${d.to}`);
  });
});

on(/^\/settings$/, async () => {
  setChrome({ title: 'Clinic settings', back: true, nav: false });
  await loadSettings();
  const s = state.settings;
  view.innerHTML = `<form class="form" id="f">
    <div class="field"><label>Clinic name</label><input name="clinic_name" value="${esc(s.clinic_name)}"></div>
    <div class="field"><label>Doctor's name</label><input name="doctor_name" value="${esc(s.doctor_name)}"></div>
    <div class="field"><label>Clinic phone</label><input name="clinic_phone" type="tel" value="${esc(s.clinic_phone)}"></div>
    <div class="field"><label>Clinic address</label><textarea name="clinic_address">${esc(s.clinic_address)}</textarea></div>
    <div class="grid2">
      <div class="field"><label>Currency symbol</label><input name="currency" value="${esc(s.currency)}" maxlength="4"></div>
      <div class="field"><label>Country code</label><input name="country_code" inputmode="numeric" value="${esc(s.country_code)}" maxlength="4"></div>
    </div>
    <div class="field"><label>Payment reminder message</label><textarea name="reminder_template" rows="4">${esc(s.reminder_template)}</textarea>
      <div class="muted small">Use {name}, {amount} and {clinic} — they are filled in automatically.</div></div>
    <button class="btn block" type="submit">Save settings</button>
  </form>`;
  bindSubmit($('#f'), async (d) => {
    state.settings = await api('PUT', '/api/settings', d);
    toast('Settings saved');
    goBack('#/more');
  });
});

/* ---------------- boot ---------------- */
$('#back-btn').addEventListener('click', () => {
  const path = location.hash.slice(1).split('?')[0];
  const parent = path.replace(/\/[^/]+$/, '').replace(/\/(visits|payments)$/, '') || '/';
  goBack(`#${parent}`);
});

window.addEventListener('hashchange', () => { state.navigated = true; router(); });

// Rows that contain their own buttons/links can't be <a> elements, so they navigate via data-href.
view.addEventListener('click', (e) => {
  const row = e.target.closest('[data-href]');
  if (row && !e.target.closest('a, button')) location.hash = row.dataset.href;
});

(async function boot() {
  try {
    await loadSettings();
  } catch (e) {
    view.innerHTML = `<div class="card empty">Cannot open the clinic data.<br>${esc(e.message)}</div>`;
    return;
  }
  if (state.settings.setup_done !== 'yes') history.replaceState(null, '', '#/welcome');
  router();
})();
