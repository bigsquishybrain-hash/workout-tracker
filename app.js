/* Workout Tracker — offline-first PWA. Data lives in localStorage; Excel export/import mirrors WorkoutTracker.xlsx. */
'use strict';

const KEY = 'wt-db-v1';
const UNIT = 'lb';
const SEED = [
  [1, 'Chest', ['Machine Chest Press', 'Machine Fly', 'Machine Reverse Fly']],
  [2, 'Arms', ['Seated Preacher Curls', 'Machine Triceps Extension', 'Machine Triceps Press']],
  [3, 'Shoulders/Lats', ['Machine Shoulder Press', 'Machine Lateral Arm Raise']],
  [4, 'Back', ['Cable Lat Pull Down', 'Cable Row', 'Back Extension Machine']],
  [5, 'Abs', ['Machine Ab Crunch']],
];

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayStr = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fmtDate = (s) => new Date(s + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

/* ---------- storage ---------- */
function seedDb() {
  const exercises = []; let n = 1;
  for (const [order, group, names] of SEED)
    for (const name of names) exercises.push({ id: 'EX' + String(n++).padStart(3, '0'), groupOrder: order, group, name, active: true });
  return { exercises, log: [] };
}
let db;
try { db = JSON.parse(localStorage.getItem(KEY)) || seedDb(); } catch { db = seedDb(); }
let savedTimer;
function save() {
  localStorage.setItem(KEY, JSON.stringify(db));
  Sync.markDirty();
  const el = $('#saved'); el.textContent = 'Saved ✓'; el.style.opacity = 1;
  clearTimeout(savedTimer); savedTimer = setTimeout(() => (el.style.opacity = 0), 1200);
}

/* ---------- helpers ---------- */
const groups = () => {
  const m = new Map();
  for (const e of db.exercises) if (!m.has(e.group)) m.set(e.group, e.groupOrder);
  return [...m.entries()].sort((a, b) => a[1] - b[1]).map(([g, o]) => ({ group: g, order: o }));
};
const exById = (id) => db.exercises.find((e) => e.id === id);
const setsFor = (date, exId) => db.log.filter((r) => r.date === date && r.exerciseId === exId).sort((a, b) => a.set - b.set);
const sessionDates = (exId) => [...new Set(db.log.filter((r) => r.exerciseId === exId).map((r) => r.date))].sort().reverse();
function lastSession(exId, beforeDate) {
  const d = sessionDates(exId).find((x) => x < beforeDate);
  return d ? { date: d, sets: setsFor(d, exId) } : null;
}
const setText = (r) => `${r.reps || 0} × ${r.weight || 0}`;
function renumber(date, exId) { setsFor(date, exId).forEach((r, i) => (r.set = i + 1)); }

/* ---------- navigation ---------- */
const TITLES = { today: 'Today', history: 'History', exercises: 'Exercises', backup: 'Backup' };
function show(view) {
  document.querySelectorAll('.view').forEach((v) => (v.hidden = v.id !== 'view-' + view));
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('#title').textContent = TITLES[view];
  ({ today: renderToday, history: renderHistory, exercises: renderExercises, backup: renderBackup })[view]();
}
document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));

/* ---------- TODAY ---------- */
const ui = { date: todayStr(), group: null };
$('#today-date').value = ui.date;
$('#today-date').addEventListener('change', (e) => { ui.date = e.target.value || todayStr(); ui.group = null; renderToday(); });

function suggestedGroup() {
  const gs = groups(); if (!gs.length) return null;
  const onDate = db.log.find((r) => r.date === ui.date);
  if (onDate) return onDate.group;
  const prior = db.log.filter((r) => r.date < ui.date).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (!prior) return gs[0].group;
  const i = gs.findIndex((g) => g.group === prior.group);
  return gs[(i + 1) % gs.length].group;
}

function renderToday() {
  const next = suggestedGroup();
  if (!ui.group || !groups().some((g) => g.group === ui.group)) ui.group = next;
  $('#group-picker').innerHTML = groups().map((g) =>
    `<button class="${g.group === ui.group ? 'on' : ''} ${g.group === next ? 'next' : ''}" data-g="${esc(g.group)}">${esc(g.group)}</button>`).join('');
  $('#group-picker').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { ui.group = b.dataset.g; renderToday(); }));
  const loggedToday = db.log.some((r) => r.date === ui.date);
  $('#group-hint').textContent = !next ? '' : loggedToday ? `Logged today: ${next}` : `Up next in your rotation: ${next}`;

  const exs = db.exercises.filter((e) => e.group === ui.group && e.active);
  if (!exs.length) { $('#today-list').innerHTML = '<p class="empty">No exercises in this group. Add some on the Exercises tab.</p>'; return; }

  $('#today-list').innerHTML = exs.map((e) => {
    const sets = setsFor(ui.date, e.id);
    const last = lastSession(e.id, ui.date);
    const doneN = sets.filter((s) => s.completed).length;
    return `<div class="card" data-ex="${e.id}">
      <div class="ex-head"><span class="ex-name">${esc(e.name)}</span>
        ${sets.length ? `<span class="ex-done">${doneN}/${sets.length} done</span>` : ''}</div>
      <div class="last">${last ? `Last (${fmtDate(last.date)}): ${last.sets.map(setText).join(', ')} ${UNIT}` : 'No history yet'}</div>
      ${sets.length ? `<div class="set-head"><span>#</span><span>Reps</span><span>Weight (${UNIT})</span><span>Done</span><span></span></div>` : ''}
      ${sets.map((s) => `<div class="set ${s.completed ? 'done' : ''}" data-set="${s.set}">
          <span class="n">${s.set}</span>
          <input type="number" inputmode="numeric" min="0" data-f="reps" value="${s.reps ?? ''}">
          <input type="number" inputmode="decimal" min="0" step="0.5" data-f="weight" value="${s.weight ?? ''}">
          <label class="chk"><input type="checkbox" data-f="completed" ${s.completed ? 'checked' : ''}></label>
          <button class="x" data-act="del" title="Remove set">×</button></div>`).join('')}
      <div class="btns">
        <button class="small" data-act="add">+ Add set</button>
        ${!sets.length && last ? '<button class="small primary" data-act="copy">Repeat last session</button>' : ''}
      </div></div>`;
  }).join('');
}

$('#today-list').addEventListener('input', (ev) => {
  const t = ev.target, f = t.dataset.f; if (!f) return;
  const card = t.closest('[data-ex]'), row = t.closest('[data-set]');
  const r = setsFor(ui.date, card.dataset.ex).find((s) => s.set === +row.dataset.set); if (!r) return;
  if (f === 'completed') { r.completed = t.checked; save(); renderToday(); return; }
  r[f] = t.value === '' ? null : Number(t.value);
  save();
});

$('#today-list').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-act]'); if (!b) return;
  const exId = b.closest('[data-ex]').dataset.ex, e = exById(exId);
  const sets = setsFor(ui.date, exId);
  const base = { sessionId: `${ui.date}_${e.group}`, date: ui.date, group: e.group, exerciseId: e.id, exercise: e.name, unit: UNIT, completed: false, notes: '' };
  if (b.dataset.act === 'add') {
    const prev = sets[sets.length - 1] || lastSession(exId, ui.date)?.sets.slice(-1)[0];
    db.log.push({ ...base, set: sets.length + 1, reps: prev?.reps ?? null, weight: prev?.weight ?? null });
  } else if (b.dataset.act === 'copy') {
    lastSession(exId, ui.date).sets.forEach((s, i) => db.log.push({ ...base, set: i + 1, reps: s.reps, weight: s.weight }));
  } else if (b.dataset.act === 'del') {
    const n = +b.closest('[data-set]').dataset.set;
    db.log = db.log.filter((r) => !(r.date === ui.date && r.exerciseId === exId && r.set === n));
    renumber(ui.date, exId);
  }
  save(); renderToday();
});

/* ---------- HISTORY ---------- */
let histEx = null;
function renderHistory() {
  const sel = $('#hist-exercise');
  sel.innerHTML = groups().map((g) => `<optgroup label="${esc(g.group)}">${db.exercises.filter((e) => e.group === g.group)
    .map((e) => `<option value="${e.id}">${esc(e.name)}${e.active ? '' : ' (deleted)'}</option>`).join('')}</optgroup>`).join('');
  if (!histEx || !exById(histEx)) histEx = db.exercises[0]?.id;
  sel.value = histEx;
  const dates = sessionDates(histEx);
  const done = db.log.filter((r) => r.exerciseId === histEx && r.completed);
  const best = done.reduce((m, r) => Math.max(m, r.weight || 0), 0);
  $('#hist-summary').innerHTML = `<div><b>${dates.length}</b><small>sessions</small></div>
    <div><b>${best ? best + ' ' + UNIT : '–'}</b><small>best weight</small></div>
    <div><b>${dates[0] ? new Date(dates[0] + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '–'}</b><small>last done</small></div>`;
  $('#hist-list').innerHTML = dates.length ? dates.map((d) => {
    const s = setsFor(d, histEx);
    const vol = s.filter((r) => r.completed).reduce((t, r) => t + (r.reps || 0) * (r.weight || 0), 0);
    return `<div class="card sess"><div class="ex-head"><span class="date">${fmtDate(d)}</span><span class="last">${vol ? vol.toLocaleString() + ' ' + UNIT + ' volume' : ''}</span></div>
      <ul>${s.map((r) => `<li class="${r.completed ? '' : 'skip'}">Set ${r.set}: ${setText(r)} ${UNIT}${r.completed ? '' : ' (not done)'}</li>`).join('')}</ul></div>`;
  }).join('') : '<p class="empty">Nothing logged for this one yet. Go lift something.</p>';
}
$('#hist-exercise').addEventListener('change', (e) => { histEx = e.target.value; renderHistory(); });

/* ---------- EXERCISES ---------- */
function renderExercises() {
  const opts = groups().map((g) => `<option>${esc(g.group)}</option>`).join('');
  $('#add-group').innerHTML = opts + '<option value="__new">+ New group…</option>';
  $('#add-newgroup').hidden = true;
  $('#ex-list').innerHTML = groups().map((g) => `<div class="grp-title">${esc(g.group)}</div>` +
    db.exercises.filter((e) => e.group === g.group).map((e) => `<div class="ex-row ${e.active ? '' : 'inactive'}"><span>${esc(e.name)}</span>
      <button class="small ${e.active ? 'danger' : ''}" data-id="${e.id}">${e.active ? 'Delete' : 'Restore'}</button></div>`).join('')).join('');
}
$('#add-group').addEventListener('change', (e) => { $('#add-newgroup').hidden = e.target.value !== '__new'; });
$('#add-ex').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const name = $('#add-name').value.trim(); if (!name) return;
  let group = $('#add-group').value, order;
  if (group === '__new') {
    group = $('#add-newgroup').value.trim(); if (!group) return alert('Give the new group a name.');
  }
  const existing = groups().find((g) => g.group.toLowerCase() === group.toLowerCase());
  if (existing) { group = existing.group; order = existing.order; } else order = Math.max(0, ...groups().map((g) => g.order)) + 1;
  const n = Math.max(0, ...db.exercises.map((e) => parseInt(e.id.slice(2), 10) || 0)) + 1;
  db.exercises.push({ id: 'EX' + String(n).padStart(3, '0'), groupOrder: order, group, name, active: true });
  $('#add-name').value = ''; $('#add-newgroup').value = '';
  save(); renderExercises();
});
$('#ex-list').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-id]'); if (!b) return;
  const e = exById(b.dataset.id);
  if (e.active && !confirm(`Delete "${e.name}"? Its history is kept and you can restore it.`)) return;
  e.active = !e.active; save(); renderExercises();
});

/* ---------- BACKUP (Excel) ---------- */
const EX_COLS = ['ExerciseID', 'GroupOrder', 'Group', 'Exercise', 'Active'];
const LOG_COLS = ['SessionID', 'Date', 'Group', 'ExerciseID', 'Exercise', 'Set', 'Reps', 'Weight', 'Unit', 'Completed', 'Notes'];
const ABOUT = [
  ['Workout Tracker data file. The web app reads and writes this file.'],
  ['Exercises: your list. Active=No hides an exercise without losing its history.'],
  ['Log: one row per set. Date is YYYY-MM-DD. Completed = Yes/No.'],
  ['History for an exercise = filter Log by ExerciseID.'],
  ["Don't rename sheets or headers or the app will choke."],
];
function buildWorkbook() {
  const wb = XLSX.utils.book_new();
  const ex = db.exercises.slice().sort((a, b) => a.groupOrder - b.groupOrder || a.id.localeCompare(b.id))
    .map((e) => [e.id, e.groupOrder, e.group, e.name, e.active ? 'Yes' : 'No']);
  const log = db.log.slice().sort((a, b) => a.date.localeCompare(b.date) || a.exerciseId.localeCompare(b.exerciseId) || a.set - b.set)
    .map((r) => [r.sessionId, r.date, r.group, r.exerciseId, r.exercise, r.set, r.reps, r.weight, r.unit, r.completed ? 'Yes' : 'No', r.notes || '']);
  const s1 = XLSX.utils.aoa_to_sheet([EX_COLS, ...ex]); s1['!cols'] = [12, 12, 18, 30, 8].map((w) => ({ wch: w }));
  const s2 = XLSX.utils.aoa_to_sheet([LOG_COLS, ...log]); s2['!cols'] = [16, 12, 16, 12, 30, 6, 6, 8, 6, 11, 30].map((w) => ({ wch: w }));
  const s3 = XLSX.utils.aoa_to_sheet(ABOUT); s3['!cols'] = [{ wch: 90 }];
  XLSX.utils.book_append_sheet(wb, s1, 'Exercises');
  XLSX.utils.book_append_sheet(wb, s2, 'Log');
  XLSX.utils.book_append_sheet(wb, s3, 'About');
  return wb;
}
function normDate(v) {
  if (v instanceof Date) { const d = new Date(v); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
  if (typeof v === 'number') { const p = XLSX.SSF.parse_date_code(v); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; }
  return String(v).trim().slice(0, 10);
}
const yes = (v) => v === true || /^(yes|y|true|1)$/i.test(String(v).trim());
const num = (v) => (v === '' || v == null ? null : Number(v));
function parseWorkbook(wb) {
  const ws1 = wb.Sheets.Exercises, ws2 = wb.Sheets.Log;
  if (!ws1 || !ws2) throw new Error('That file needs "Exercises" and "Log" sheets.');
  const exercises = XLSX.utils.sheet_to_json(ws1, { defval: '' }).filter((r) => r.ExerciseID && r.Exercise).map((r) => ({
    id: String(r.ExerciseID).trim(), groupOrder: Number(r.GroupOrder) || 99, group: String(r.Group).trim() || 'Other', name: String(r.Exercise).trim(), active: r.Active === '' ? true : yes(r.Active),
  }));
  const log = XLSX.utils.sheet_to_json(ws2, { defval: '' }).filter((r) => r.Date && r.ExerciseID).map((r) => {
    const date = normDate(r.Date); const e = exercises.find((x) => x.id === String(r.ExerciseID).trim());
    return {
      sessionId: String(r.SessionID || `${date}_${r.Group}`), date, group: String(r.Group || e?.group || ''), exerciseId: String(r.ExerciseID).trim(),
      exercise: String(r.Exercise || e?.name || ''), set: Number(r.Set) || 1, reps: num(r.Reps), weight: num(r.Weight), unit: String(r.Unit || UNIT), completed: yes(r.Completed), notes: String(r.Notes || ''),
    };
  });
  return { exercises, log };
}
$('#btn-export').addEventListener('click', () => XLSX.writeFile(buildWorkbook(), 'WorkoutTracker.xlsx'));
$('#file-import').addEventListener('change', async (ev) => {
  const f = ev.target.files[0]; if (!f) return;
  try {
    const data = parseWorkbook(XLSX.read(await f.arrayBuffer(), { cellDates: true }));
    if (!confirm(`Replace this phone's data with ${data.exercises.length} exercises and ${data.log.length} logged sets from ${f.name}?`)) return;
    db = data; save(); renderBackup();
    alert('Restored.');
  } catch (e) { alert('Import failed: ' + e.message); } finally { ev.target.value = ''; }
});
function renderBackup() {
  const sessions = new Set(db.log.map((r) => r.date)).size;
  $('#stats').textContent = `On this phone: ${db.exercises.filter((e) => e.active).length} exercises, ${sessions} workout days, ${db.log.length} sets logged.`;
}

/* ---------- boot ---------- */
function replaceDb(data) {
  db = data; localStorage.setItem(KEY, JSON.stringify(db));
  const v = document.querySelector('nav button.active')?.dataset.view || 'today'; show(v);
}
window.WT = { get db() { return db; }, buildWorkbook, parseWorkbook, replaceDb };

/* ---------- Drive sync UI ---------- */
Sync.onStatus((s) => {
  const b = $('#sync-btn');
  b.hidden = s.state === 'off' && !Sync.configured();
  b.className = 'sync ' + s.state;
  b.textContent = (s.state === 'ok' ? '☁️ ' : s.state === 'busy' ? '⏳ ' : s.state === 'off' ? '☁️ ' : '⚠️ ') + s.text;
  $('#drive-status').textContent = s.text;
  const connected = s.state !== 'off';
  $('#btn-connect').hidden = connected || !Sync.configured();
  $('#btn-syncnow').hidden = $('#btn-pull').hidden = $('#btn-disconnect').hidden = !connected;
  $('#drive-notset').hidden = Sync.configured();
});
$('#sync-btn').addEventListener('click', () => (Sync.status().state === 'off' ? show('backup') : Sync.syncNow()));
$('#btn-connect').addEventListener('click', () => Sync.connect());
$('#btn-syncnow').addEventListener('click', () => Sync.syncNow());
$('#btn-pull').addEventListener('click', () => {
  if (confirm('Replace everything on this phone with the copy in Google Drive?')) Sync.pull();
});
$('#btn-disconnect').addEventListener('click', () => { if (confirm('Disconnect Google Drive? Your data stays on the phone and in Drive.')) Sync.disconnect(); });
show('today');
Sync.tryAuto();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js');
