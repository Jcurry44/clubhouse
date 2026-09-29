// Clubhouse — backup: export / detect / preview / restore / snapshots / nudge (SPEC §3.4–3.8).
// Data safety is sacred: every write path here snapshots first, and export never mutates a store.

import * as store from './store.js';
import { VENDORED_KEYS, readRaw, writeRaw } from './ls.js';
import { CACHE_VERSION } from './version.js';
import { fileStamp } from './dates.js';

export const FORMAT = 1;
export const IDB_STORES = store.DATA_STORES; // workouts, exercises, templates, prs, pours, watched, trainForm, settings
export const SNAP_KEEP = 5;
export const NUDGE_DAYS = 7;
export const NUDGE_RECORDS = 3;
export const SNOOZE_DAYS = 2;

/* ------------------------------------------------------------------ helpers */

function safeParse(raw) {
  if (typeof raw !== 'string') return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** Train lane: sessions inside the imported Form dataset (trainForm store, row {key:'dataset', sessions:[…]}). */
export function trainSessions(rows) {
  const r = Array.isArray(rows) ? rows.find((x) => x && x.key === 'dataset') : null;
  return r && Array.isArray(r.sessions) ? r.sessions.length : 0;
}

/** rounds / tastings / open-bottle counts from the vendored raw strings. */
export function vendoredCounts(lsObj = {}) {
  const fl = safeParse(lsObj['fairwayLedger.v1']);
  const bp = safeParse(lsObj['barrel-proof-state-v1']);
  const rounds = fl && Array.isArray(fl.rounds) ? fl.rounds.length : 0;
  const courses = fl && Array.isArray(fl.courses) ? fl.courses.length : 0;
  const tastings = bp && Array.isArray(bp.tastings) ? bp.tastings.length : 0;
  return { rounds, courses, tastings };
}

/** 'iPhone · Safari 26' style label from the user agent. */
export function deviceLabel(ua = globalThis.navigator?.userAgent || '') {
  const dev = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Browser';
  let br = 'Browser';
  let m;
  if ((m = /Edg\/(\d+)/.exec(ua))) br = `Edge ${m[1]}`;
  else if ((m = /CriOS\/(\d+)/.exec(ua)) || (m = /Chrome\/(\d+)/.exec(ua))) br = `Chrome ${m[1]}`;
  else if ((m = /FxiOS\/(\d+)/.exec(ua)) || (m = /Firefox\/(\d+)/.exec(ua))) br = `Firefox ${m[1]}`;
  else if ((m = /Version\/(\d+)[.\d]* .*Safari/.exec(ua))) br = `Safari ${m[1]}`;
  else if (/AppleWebKit/.test(ua)) br = 'Safari';
  return `${dev} · ${br}`;
}

export function fileName(d = new Date()) {
  return `clubhouse-backup-${fileStamp(d)}.json`;
}

function readVendored() {
  const out = {};
  for (const k of VENDORED_KEYS) {
    const v = readRaw(k);
    if (v != null) out[k] = v;
  }
  return out;
}

/* ------------------------------------------------------------------ payload */

/**
 * The §3.5 object, keys in contract order. `localStorage` values are the raw strings, verbatim.
 * The settings rows carry backup.lastExportAt/Counts = this export, so a restore of this file reads
 * "last backup = this file".
 */
export async function buildPayload(now = new Date(), { forSnapshot = false, lsBefore = null } = {}) {
  const idb = await store.dumpAll();
  const ls = readVendored();
  // lsBefore: raw vendored values captured earlier (synchronously, before a vendored app's own destructive handler ran);
  // a null value means the key did not exist then. Only VENDORED_KEYS are honoured.
  if (lsBefore && typeof lsBefore === 'object') {
    for (const [k, v] of Object.entries(lsBefore)) {
      if (!VENDORED_KEYS.includes(k)) continue;
      if (typeof v === 'string') ls[k] = v; else delete ls[k];
    }
  }
  const v = vendoredCounts(ls);
  const exportedAt = now.toISOString();
  const counts = {
    workouts: idb.workouts.length + trainSessions(idb.trainForm), exercises: idb.exercises.length, templates: idb.templates.length, prs: idb.prs.length,
    pours: idb.pours.length, watched: idb.watched.length, settings: idb.settings.length,
    rounds: v.rounds, tastings: v.tastings,
    trainSessions: trainSessions(idb.trainForm), // Train: the Form sessions inside `workouts` above
  };
  if (!forSnapshot) {
    const exportCounts = { workouts: counts.workouts, rounds: counts.rounds, tastings: counts.tastings, pours: counts.pours, watched: counts.watched };
    const rest = idb.settings.filter((r) => r.key !== 'backup.lastExportAt' && r.key !== 'backup.lastExportCounts');
    idb.settings = [...rest, { key: 'backup.lastExportAt', value: exportedAt }, { key: 'backup.lastExportCounts', value: exportCounts }];
    counts.settings = idb.settings.length;
  }
  const payload = {
    app: 'clubhouse',
    format: FORMAT,
    exportedAt,
    device: deviceLabel(),
    cacheVersion: CACHE_VERSION,
    counts,
    idb: Object.fromEntries(IDB_STORES.map((s) => [s, idb[s]])),
    localStorage: ls,
  };
  if (forSnapshot) payload.lsAbsent = VENDORED_KEYS.filter((k) => !(k in ls));
  return payload;
}

/* ------------------------------------------------------------------ export */

let prepared = null;
let preparing = null;
const PREP_TTL = 10 * 60 * 1000;

function invalidate() { prepared = null; }
store.events.addEventListener('change', (e) => { if (e.detail?.store !== 'snapshots') invalidate(); });
if (typeof window !== 'undefined') {
  window.addEventListener('clubhouse:refresh', invalidate);
  window.addEventListener('storage', invalidate);
}

/**
 * Build the Blob ahead of the tap (iOS only honours navigator.share inside the user gesture,
 * so the tap handler must not await IndexedDB first). Cached until any store changes.
 */
export function prepare(now = new Date()) {
  if (prepared && Date.now() - prepared.builtAt < PREP_TTL) return Promise.resolve(prepared);
  if (preparing) return preparing;
  preparing = buildPayload(now).then((payload) => {
    const text = JSON.stringify(payload, null, 2);
    const name = fileName(now);
    const blob = new Blob([text], { type: 'application/json' });
    let file = null;
    try { file = new File([blob], name, { type: 'application/json' }); } catch { file = null; }
    prepared = { payload, text, blob, file, name, bytes: blob.size, builtAt: Date.now() };
    return prepared;
  }).finally(() => { preparing = null; });
  return preparing;
}

/** The prepared export if it is fresh (sync — safe inside a tap handler). */
export function getPrepared() {
  return prepared && Date.now() - prepared.builtAt < PREP_TTL ? prepared : null;
}

function canShareFile(file) {
  try { return Boolean(file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] })); } catch { return false; }
}

/**
 * Hand the file over. MUST be called synchronously inside the tap handler.
 * Web Share (iOS → Files / iCloud in one tap) when files can be shared, else an <a download> click.
 * Resolves { ok, method, cancelled?, error? }.
 */
export function deliver(prep) {
  if (canShareFile(prep.file)) {
    let p;
    try { p = navigator.share({ files: [prep.file], title: 'Clubhouse backup' }); } catch (err) { p = Promise.reject(err); }
    return p.then(() => ({ ok: true, method: 'share' }), (err) => {
      if (err && err.name === 'AbortError') return { ok: false, method: 'share', cancelled: true };
      return { ok: false, method: 'share', error: err };
    });
  }
  try {
    const url = URL.createObjectURL(prep.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = prep.name;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return Promise.resolve({ ok: true, method: 'download' });
  } catch (err) {
    return Promise.resolve({ ok: false, method: 'download', error: err });
  }
}

/** After a successful delivery: remember when and what was backed up. */
export async function recordExport(payload) {
  const c = payload.counts;
  await store.setSetting('backup.lastExportAt', payload.exportedAt);
  await store.setSetting('backup.lastExportCounts', { workouts: c.workouts, rounds: c.rounds, tastings: c.tastings, pours: c.pours, watched: c.watched });
}

export function exportToast(payload) {
  const c = payload.counts;
  const parts = [`${c.rounds} ${c.rounds === 1 ? 'round' : 'rounds'}`, `${c.workouts} ${c.workouts === 1 ? 'workout' : 'workouts'}`];
  if (c.tastings) parts.push(`${c.tastings} ${c.tastings === 1 ? 'tasting' : 'tastings'}`);
  if (c.watched) parts.push(`${c.watched} ${c.watched === 1 ? 'game' : 'games'} watched`); // Sports lane: watched games ride in every backup
  return `Backed up · ${parts.join(' · ')}`;
}

/**
 * One-tap export for buttons (Backup screen, the X1 nudge). Call it directly from the click handler.
 * onDone({ ok, method, cancelled, message }) — message is the toast text.
 */
export function exportNow() {
  const ready = getPrepared();
  const finish = async (res, prep) => {
    if (res.ok) {
      await recordExport(prep.payload);
      return { ...res, message: exportToast(prep.payload) };
    }
    if (res.cancelled) return { ...res, message: 'Backup not saved — nothing changed.' };
    if (res.error && res.error.name === 'NotAllowedError') return { ...res, retry: true, message: 'Ready — tap Back up now once more.' };
    return { ...res, message: 'Couldn’t hand the file over. Try again.' };
  };
  if (ready) return deliver(ready).then((res) => finish(res, ready));
  return prepare().then((prep) => deliver(prep).then((res) => finish(res, prep)));
}

/* ------------------------------------------------------------------ import */

/** SPEC §3.6 detection table. */
export function detect(obj) {
  if (!obj || typeof obj !== 'object') return 'unknown';
  if (obj.app === 'clubhouse' && Number.isInteger(obj.format) && obj.format <= FORMAT && obj.idb && typeof obj.idb === 'object') return 'clubhouse';
  if (Array.isArray(obj.courses) && Array.isArray(obj.rounds)) return 'fairway-ledger';
  if (obj.app === 'barrel-proof' && obj.state && typeof obj.state === 'object') return 'barrel-proof';
  return 'unknown';
}

/** Structural check of a clubhouse payload before anything is written. Returns an error string or null. */
export function validate(payload) {
  if (detect(payload) !== 'clubhouse') return 'not a Clubhouse backup';
  for (const [s, rows] of Object.entries(payload.idb)) {
    if (!IDB_STORES.includes(s)) continue;
    if (!Array.isArray(rows)) return `${s} is not a list`;
    const kp = store.SCHEMA[s].keyPath;
    for (const r of rows) {
      if (!r || typeof r !== 'object' || r[kp] == null || r[kp] === '') return `${s} has a row without ${kp}`;
    }
  }
  for (const r of Array.isArray(payload.idb.trainForm) ? payload.idb.trainForm : []) {
    if (r.key === 'dataset' && !Array.isArray(r.sessions)) return 'the Form data is malformed';
  }
  if (payload.localStorage != null && typeof payload.localStorage !== 'object') return 'localStorage block is malformed';
  for (const [k, v] of Object.entries(payload.localStorage || {})) {
    if (VENDORED_KEYS.includes(k) && typeof v !== 'string') return `${k} is not a raw string`;
  }
  return null;
}

/** Counts for the preview (file side), only for what the file carries. */
export function fileCounts(payload) {
  const idb = payload.idb || {};
  const out = {};
  for (const s of IDB_STORES) if (s !== 'trainForm' && Array.isArray(idb[s])) out[s] = idb[s].length;
  if (Array.isArray(idb.trainForm)) out.workouts = (out.workouts || 0) + trainSessions(idb.trainForm); // Form sessions are workouts
  const ls = payload.localStorage || {};
  const v = vendoredCounts(ls);
  if ('fairwayLedger.v1' in ls) out.rounds = v.rounds;
  if ('barrel-proof-state-v1' in ls) out.tastings = v.tastings;
  return out;
}

export async function nowCounts() {
  const { trainForm, ...c } = await store.counts();
  const ds = await store.get('trainForm', 'dataset');
  c.workouts = (c.workouts || 0) + trainSessions(ds ? [ds] : []);
  const v = vendoredCounts(readVendored());
  return { ...c, rounds: v.rounds, tastings: v.tastings };
}

const PREVIEW_ROWS = [
  ['workouts', 'Workouts'], ['prs', 'PRs'], ['pours', 'Pours'], ['watched', 'Watched games'], ['rounds', 'Rounds'], ['tastings', 'Tastings'],
];
/** Rows for the confirm table: [{ label, now, file }] for stores present in the file. */
export function previewRows(now, file) {
  return PREVIEW_ROWS.filter(([k]) => file[k] != null).map(([k, label]) => ({ key: k, label, now: now[k] ?? 0, file: file[k] }));
}

/* ------------------------------------------------------------------ snapshots */

function snapId() {
  return `snap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6).padEnd(4, '0')}`;
}

/**
 * Full-state snapshot into IDB (rolling 5). Taken before EVERY destructive action.
 * opts.lsBefore (optional): vendored raw strings captured before the destructive action began (see buildPayload).
 */
export async function snapshot(label, { lsBefore = null } = {}) {
  const payload = await buildPayload(new Date(), { forSnapshot: true, lsBefore });
  const bytes = JSON.stringify(payload).length;
  const row = { id: snapId(), label: String(label || 'manual'), at: payload.exportedAt, bytes, counts: payload.counts, payload };
  await store.addSnapshot(row, SNAP_KEEP);
  return row;
}

/** Newest first, payload stripped. */
export async function listSnapshots() {
  const rows = await store.getAll('snapshots');
  return rows.sort((a, b) => (a.id < b.id ? 1 : -1)).map(({ payload, ...meta }) => meta);
}

export async function getSnapshot(id) {
  return store.get('snapshots', id);
}

/* ------------------------------------------------------------------ restore */

/**
 * Apply a payload (no snapshot — callers go through restore()). Per-store transactions;
 * stores missing from the file are untouched; settings are written LAST.
 * Snapshot payloads carry lsAbsent: vendored keys that did not exist then are removed so an Undo is exact.
 */
export async function applyPayload(payload) {
  const idb = payload.idb || {};
  const order = IDB_STORES.filter((s) => s !== 'settings' && Array.isArray(idb[s]));
  for (const s of order) await store.replaceAll(s, idb[s]);
  const ls = payload.localStorage || {};
  for (const [k, v] of Object.entries(ls)) {
    if (VENDORED_KEYS.includes(k) && typeof v === 'string') writeRaw(k, v);
  }
  if (Array.isArray(payload.lsAbsent)) {
    for (const k of payload.lsAbsent) if (VENDORED_KEYS.includes(k)) localStorage.removeItem(k);
  }
  if (Array.isArray(idb.settings)) await store.replaceAll('settings', idb.settings);
}

/**
 * The only path that writes a backup over live data: snapshot (awaited) → validate → apply.
 * Throws { code:'snapshot' } if the snapshot fails (nothing changed), { code:'invalid' } on a bad file.
 * Returns { snap, counts }.
 */
export async function restore(payload, label = 'before-import') {
  const problem = validate(payload);
  if (problem) { const e = new Error(problem); e.code = 'invalid'; throw e; }
  let snap;
  try {
    snap = await snapshot(label);
  } catch (err) {
    const e = new Error('snapshot failed'); e.code = 'snapshot'; e.cause = err; throw e;
  }
  await applyPayload(payload);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('clubhouse:refresh'));
  return { snap, counts: fileCounts(payload) };
}

/** Restore a stored snapshot (itself preceded by a new snapshot). */
export async function restoreSnapshot(id, label = 'before-restore') {
  const row = await getSnapshot(id);
  if (!row || !row.payload) { const e = new Error('snapshot not found'); e.code = 'missing'; throw e; }
  return restore(row.payload, label);
}

/* ------------------------------------------------------------------ nudge (§3.8) */

/**
 * Pure. facts = Home's { train:{totalWorkouts}, golf:{rounds}, bourbon:{tastings}, sports:{watched} } (any may be missing),
 * settings = { lastExportAt, lastExportCounts, snoozedUntil, pours, watched } (or the 'backup.*' keys).
 * Returns { due, reason:'age'|'volume'|null, days, newRecords }.
 * Nothing to back up → never due (a nudge on day one with zero data is noise).
 */
export function needsNudge(facts = {}, settings = {}, now = new Date()) {
  const s = (k) => (settings[k] !== undefined ? settings[k] : settings[`backup.${k}`]);
  const lastAt = s('lastExportAt') || null;
  const last = s('lastExportCounts') || {};
  const snoozedUntil = s('snoozedUntil') || null;
  const workouts = Number(facts.train?.totalWorkouts) || 0;
  const rounds = Array.isArray(facts.golf?.rounds) ? facts.golf.rounds.length : Number(facts.golf?.roundCount) || 0;
  const bpTastings = Array.isArray(facts.bourbon?.tastings) ? facts.bourbon.tastings.filter((t) => t.source !== 'clubhouse').length : 0;
  const pours = Number(settings.pours ?? facts.bourbon?.poursCount) || 0;
  const watched = Number(settings.watched ?? facts.sports?.watchedCount) || 0;
  const total = workouts + rounds + bpTastings + pours + watched;
  const newRecords = Math.max(0, workouts - (last.workouts || 0)) + Math.max(0, rounds - (last.rounds || 0))
    + Math.max(0, bpTastings - (last.tastings || 0)) + Math.max(0, pours - (last.pours || 0)) + Math.max(0, watched - (last.watched || 0));
  const days = lastAt ? Math.floor((now - new Date(lastAt)) / 864e5) : null;
  const base = { due: false, reason: null, days, newRecords };
  if (total === 0) return base;
  if (snoozedUntil && now < new Date(snoozedUntil)) return base;
  if (lastAt == null || now - new Date(lastAt) > NUDGE_DAYS * 864e5) return { ...base, due: true, reason: 'age' };
  if (newRecords >= NUDGE_RECORDS) return { ...base, due: true, reason: 'volume' };
  return base;
}

/** needsNudge with the settings read from IDB. */
export async function nudgeState(facts, now = new Date()) {
  const map = await store.settingsMap();
  const c = await store.counts();
  return needsNudge(facts, {
    lastExportAt: map['backup.lastExportAt'] ?? null,
    lastExportCounts: map['backup.lastExportCounts'] ?? null,
    snoozedUntil: map['backup.snoozedUntil'] ?? null,
    pours: c.pours, watched: c.watched,
  }, now);
}

export async function snooze(days = SNOOZE_DAYS, now = new Date()) {
  await store.setSetting('backup.snoozedUntil', new Date(now.getTime() + days * 864e5).toISOString());
}

/** Last export facts for the Backup screen: { at, counts } | null. */
export async function lastExport() {
  const map = await store.settingsMap();
  return map['backup.lastExportAt'] ? { at: map['backup.lastExportAt'], counts: map['backup.lastExportCounts'] || {} } : null;
}

