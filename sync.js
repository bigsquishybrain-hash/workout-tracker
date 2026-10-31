/* Google Drive sync: keeps Workouts/WorkoutTracker.xlsx in your Drive matching this phone.
   The phone is the main copy. Every change is pushed to Drive when you're signed in and online.
   On a fresh phone (never synced), the first sync pulls Drive's data in and merges it. */
'use strict';

const GOOGLE_CLIENT_ID = 'PASTE_CLIENT_ID_HERE.apps.googleusercontent.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const FOLDER_NAME = 'Workouts';
const FILE_NAME = 'WorkoutTracker.xlsx';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SYNC_KEY = 'wt-sync-v1';

const Sync = (() => {
  let st = {};
  try { st = JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch { st = {}; }
  // st: { connected, token, tokenExp, fileId, syncedAt, dirty, lastError }
  const persist = () => localStorage.setItem(SYNC_KEY, JSON.stringify(st));
  const configured = () => !GOOGLE_CLIENT_ID.startsWith('PASTE_');
  const tokenOk = () => st.token && st.tokenExp > Date.now() + 60_000;
  let busy = false, timer = null, gisLoaded = null, tokenClient = null, listeners = [];

  const emit = () => listeners.forEach((f) => f(status()));
  function status() {
    if (!configured()) return { state: 'off', text: 'Drive sync not set up' };
    if (!st.connected) return { state: 'off', text: 'Not connected to Drive' };
    if (busy) return { state: 'busy', text: 'Syncing…' };
    if (st.lastError) return { state: 'err', text: 'Sync failed, tap to retry' };
    if (st.dirty) return { state: 'dirty', text: tokenOk() && navigator.onLine ? 'Syncing soon…' : 'Not backed up, tap to sync' };
    return { state: 'ok', text: st.syncedAt ? 'Backed up ' + ago(st.syncedAt) : 'Connected' };
  }
  function ago(t) {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return m + 'm ago';
    const h = Math.round(m / 60); return h < 24 ? h + 'h ago' : Math.round(h / 24) + 'd ago';
  }

  /* ---- auth ---- */
  function loadGis() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    return gisLoaded ||= new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = res; s.onerror = () => { gisLoaded = null; rej(new Error('Could not load Google sign-in (offline?)')); };
      document.head.appendChild(s);
    });
  }
  // Must be called from a tap: Google opens a popup.
  async function getToken() {
    if (tokenOk()) return st.token;
    await loadGis();
    return new Promise((res, rej) => {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID, scope: DRIVE_SCOPE,
        callback: (r) => {
          if (r.error) return rej(new Error(r.error_description || r.error));
          st.token = r.access_token; st.tokenExp = Date.now() + (r.expires_in || 3600) * 1000; persist(); res(st.token);
        },
        error_callback: (e) => rej(new Error(e?.message || e?.type || 'Sign-in cancelled')),
      });
      tokenClient.requestAccessToken({ prompt: st.connected ? '' : 'consent' });
    });
  }

  /* ---- Drive REST ---- */
  async function api(url, opts = {}) {
    const r = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + st.token, ...(opts.headers || {}) } });
    if (r.status === 401) { st.token = null; persist(); throw new Error('Google sign-in expired, tap to sync'); }
    if (!r.ok) throw new Error(`Drive error ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r;
  }
  const q = (s) => encodeURIComponent(s);
  async function findOne(query) {
    const r = await api(`https://www.googleapis.com/drive/v3/files?q=${q(query)}&fields=files(id,name,modifiedTime)&spaces=drive&pageSize=10`);
    return (await r.json()).files?.[0] || null;
  }
  async function ensureFolder() {
    const f = await findOne(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    if (f) return f.id;
    const r = await api('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
    });
    return (await r.json()).id;
  }
  async function locateFile() {
    if (st.fileId) {
      try {
        const r = await api(`https://www.googleapis.com/drive/v3/files/${st.fileId}?fields=id,trashed`);
        if (!(await r.json()).trashed) return st.fileId;
      } catch (e) { if (/sign-in/.test(e.message)) throw e; }
    }
    const folderId = await ensureFolder();
    const f = await findOne(`name='${FILE_NAME}' and '${folderId}' in parents and trashed=false`);
    if (f) { st.fileId = f.id; persist(); return f.id; }
    // No file yet: create it.
    const meta = { name: FILE_NAME, parents: [folderId], mimeType: XLSX_MIME };
    const body = new FormData();
    body.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    body.append('file', new Blob([workbookBytes()], { type: XLSX_MIME }));
    const r = await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', body });
    st.fileId = (await r.json()).id; persist();
    return st.fileId;
  }
  const workbookBytes = () => XLSX.write(WT.buildWorkbook(), { type: 'array', bookType: 'xlsx' });
  async function download(id) {
    const r = await api(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
    return WT.parseWorkbook(XLSX.read(await r.arrayBuffer(), { cellDates: true }));
  }
  async function upload(id) {
    await api(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, {
      method: 'PATCH', headers: { 'Content-Type': XLSX_MIME }, body: new Blob([workbookBytes()], { type: XLSX_MIME }),
    });
  }

  /* ---- merge: union of both, phone wins on conflicts ---- */
  function merge(local, remote) {
    const ex = new Map(remote.exercises.map((e) => [e.id, e]));
    local.exercises.forEach((e) => ex.set(e.id, e));
    const key = (r) => `${r.date}|${r.exerciseId}|${r.set}`;
    const log = new Map(remote.log.map((r) => [key(r), r]));
    local.log.forEach((r) => log.set(key(r), r));
    return { exercises: [...ex.values()], log: [...log.values()] };
  }

  /* ---- sync ---- */
  async function run({ interactive = false, mode = 'auto' } = {}) {
    if (!configured() || busy) return;
    if (!navigator.onLine) { emit(); return; }
    if (!tokenOk() && !interactive) { emit(); return; }
    busy = true; st.lastError = null; emit();
    try {
      await getToken();
      const id = await locateFile();
      if (mode === 'pull') {
        WT.replaceDb(await download(id));
      } else if (!st.syncedAt) {
        // First sync on this phone: bring in whatever Drive already has.
        WT.replaceDb(merge(WT.db, await download(id)));
        await upload(id);
      } else {
        await upload(id);
      }
      st.connected = true; st.dirty = false; st.syncedAt = Date.now();
    } catch (e) {
      st.lastError = e.message; console.warn('Sync failed:', e);
      if (interactive) alert('Sync failed: ' + e.message);
    } finally { busy = false; persist(); emit(); }
  }

  return {
    status, configured,
    onStatus(f) { listeners.push(f); f(status()); },
    connect: () => run({ interactive: true }),
    syncNow: () => run({ interactive: true }),
    pull: () => run({ interactive: true, mode: 'pull' }),
    disconnect() {
      if (st.token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(st.token, () => {});
      st = {}; persist(); emit();
    },
    markDirty() {
      if (!st.connected) return;
      st.dirty = true; persist(); emit();
      clearTimeout(timer); timer = setTimeout(() => run(), 4000);
    },
    tryAuto() { if (st.connected && (st.dirty || !st.syncedAt)) run(); else emit(); },
    _merge: merge,
  };
})();

window.addEventListener('online', () => Sync.tryAuto());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') Sync.tryAuto(); });
setInterval(() => Sync.tryAuto(), 60_000);
