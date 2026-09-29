// Train — parse + validate a Form export ("form-v2") into Clubhouse's compact Train dataset.
// Pure (no DOM, no storage): the browser loads the id → name catalog with loadCatalog(); tests pass one in.
//
// Form's GET /api/export (src/worker/routes/backup.ts) returns:
//   { format:'form-v2', exportedAt, member:{id,displayName,…}, profile, program, sessions[], days[],
//     reviews[], follows[], customWorkouts[], healthSamples[] }
// Clubhouse reads sessions[] (what was lifted), days[] (activities, cardio, mobility) and a couple of profile
// targets. Nothing else is kept, and nothing is ever written back to Form.
//
// Counting rules mirror Form's own (src/shared/session-count.ts): a finished session counts once; a Finish-screen
// cooldown (source.parentSessionId) is part of its parent and never a session of its own; an unfinished
// ("active") session counts nowhere. Warm-up sets are dropped. Unilateral lifts use the lower side's reps
// (Form's setReps). Minutes are only ever measured (finishedAt − startedAt), never estimated.

import { isYmd, ymd, MONTHS_LONG, parseYmd, dowIndex, DOW_LONG } from '../dates.js';

export const FORM_URL = 'https://form.jjcurry027.workers.dev/';
export const FORMAT = 'form-v2';
export const DATASET_VERSION = 1;

/** How to export, in the words of Form's own screens (You tab → Settings gear → Backup). Shared by every explainer. */
export const EXPORT_STEPS = [
  { n: 1, html: 'In Form, open <b>You → Settings → Backup</b>.' },
  { n: 2, html: 'Tap <b>Prepare export</b>, then <b>Save file</b> — Files is fine.' },
  { n: 3, html: 'Come back here and <b>choose that file</b>.' },
];
export const EXPORT_HINT = 'In Form: You → Settings → Backup → Prepare export.';

const LOADED_MODES = new Set(['db', 'one', 'bar', 'machine', 'cable', 'kb']);
const UNLOADED_ID = /carry|hold|plank|walk|run|cardio|stretch|hang|bike|row-erg/i;
const MAX_SESSION_MIN = 300;
const MAX_ACTIVITY_MIN = 1440;

export const EMPTY_CATALOG = { v: 1, exercises: {}, activities: {} };

let catalogPromise = null;
/** Browser: fetch data/form-catalog.json once (cached by the service worker). Falls back to an empty catalog. */
export function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = fetch('./data/form-catalog.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((c) => (c && c.exercises ? c : EMPTY_CATALOG));
  }
  return catalogPromise;
}

/** 'bar-bench' → 'Bar Bench' (the fallback when an id is not in the catalog snapshot). */
export function humanize(id) {
  return String(id || '')
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ') || 'Exercise';
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const posInt = (v) => (num(v) != null && v > 0 ? Math.round(v) : null);

/* ------------------------------------------------------------------ detection */

/**
 * Friendly triage of any parsed JSON. → { ok:true } | { ok:false, reason, message }.
 * Reasons: 'not-object', 'clubhouse', 'other-app', 'newer', 'not-form', 'no-sessions'.
 */
export function detectForm(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, reason: 'not-object', message: `That isn’t a Form export. ${EXPORT_HINT}` };
  }
  if (obj.app === 'clubhouse') {
    return { ok: false, reason: 'clubhouse', message: 'That’s a Clubhouse backup, not a Form export. Restore it from Backups instead.' };
  }
  if ((Array.isArray(obj.courses) && Array.isArray(obj.rounds)) || obj.app === 'barrel-proof') {
    return { ok: false, reason: 'other-app', message: `That isn’t a Form export (it looks like a ${obj.app === 'barrel-proof' ? 'Barrel Proof' : 'Fairway Ledger'} file). ${EXPORT_HINT}` };
  }
  if (typeof obj.format === 'string' && obj.format !== FORMAT && /^form-v\d+/.test(obj.format)) {
    return { ok: false, reason: 'newer', message: `This export is from a different version of Form (${obj.format}). Update Clubhouse, then try again.` };
  }
  if (obj.format !== FORMAT) {
    return { ok: false, reason: 'not-form', message: `That doesn’t look like a Form export. ${EXPORT_HINT}` };
  }
  if (!Array.isArray(obj.sessions)) {
    return { ok: false, reason: 'not-form', message: `That Form file has no sessions list. ${EXPORT_HINT}` };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ helpers */

function measuredMinutes(s) {
  const a = Date.parse(s.startedAt), b = Date.parse(s.finishedAt);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  const min = Math.round((b - a) / 60000);
  return min >= 1 && min <= MAX_SESSION_MIN ? min : null;
}

function isCounted(s) {
  if (!s || typeof s !== 'object') return false;
  if (s.status === 'active') return false;
  return !(s.source && s.source.parentSessionId);
}

function localDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : ymd(d);
}

/** Focus tag from where the working sets went — a fallback title and a Coach input. */
export function focusFromGroups(g) {
  const push = g.push || 0, pull = g.pull || 0, legs = g.legs || 0, core = g.core || 0;
  const total = push + pull + legs + core;
  if (!total) return '';
  const top = Math.max(push, pull, legs, core);
  if (top / total >= 0.7) return push === top ? 'push' : pull === top ? 'pull' : legs === top ? 'legs' : 'core';
  if (legs === 0 && push + pull > 0) return 'upper';
  if (legs > 0 && push + pull === 0) return 'lower';
  return 'full';
}
const FOCUS_TITLE = { push: 'Push', pull: 'Pull', legs: 'Legs', core: 'Core', upper: 'Upper body', lower: 'Lower body', full: 'Full body' };

function programDayLabel(session, program) {
  const days = program && program.spec && Array.isArray(program.spec.days) ? program.spec.days : null;
  if (!days || !Number.isInteger(session.day) || session.day < 0) return null;
  if (session.programId && program.id && session.programId !== program.id) return null;
  const label = days[session.day] && days[session.day].label;
  return typeof label === 'string' && label.trim() ? label.trim() : null;
}

function classify(session, groups, hasCardioBlock) {
  const focus = Array.isArray(session.workout && session.workout.focus) ? session.workout.focus : [];
  if (focus.length && focus.every((f) => f === 'mobility' || f === 'recovery')) return 'mobility';
  if (focus.length && focus.every((f) => f === 'cardio' || f === 'conditioning')) return 'cardio';
  const strengthSets = (groups.push || 0) + (groups.pull || 0) + (groups.legs || 0) + (groups.core || 0);
  if (strengthSets > 0) return 'strength';
  if (hasCardioBlock) return 'cardio';
  if (focus.includes('mobility')) return 'mobility';
  return 'mixed';
}

/* ------------------------------------------------------------------ parse */

/**
 * Form export object → { ok:true, dataset, skipped } | { ok:false, reason, message }.
 * The dataset is what gets stored (IDB store trainForm, key 'dataset'):
 *   { v, source, asOf, asOfDate, importedAt, fileName, member:{id,name}, profile:{cardioTarget?,stepsTarget?},
 *     sessions:[{ id, date, at, title, focus, kind, durationMin, exercises, setCount, volume, groups,
 *                 sets:[{ exercise, exerciseId, reps, weight, lift }] }],
 *     activeMinutesByDay:{ 'YYYY-MM-DD': minutes }, activityLog:[{ date, id, name, minutes }],
 *     mobilityByDay:{ 'YYYY-MM-DD': minutes }, counts:{ sessions, days, … } }
 * Tolerates missing fields everywhere; rows it cannot use are skipped and counted, never invented.
 */
export function parseFormExport(obj, { catalog = EMPTY_CATALOG, now = new Date(), fileName = null } = {}) {
  const det = detectForm(obj);
  if (!det.ok) return det;
  const ex = (catalog && catalog.exercises) || {};
  const act = (catalog && catalog.activities) || {};
  const skipped = { sessions: 0, days: 0 };
  const dupes = new Set();

  const sessions = [];
  const activeByDay = {};
  const activityLog = [];
  const mobilityByDay = {};
  const addActive = (date, min) => { activeByDay[date] = (activeByDay[date] || 0) + min; };

  for (const raw of obj.sessions) {
    if (!raw || typeof raw !== 'object') { skipped.sessions++; continue; }
    if (!isCounted(raw)) continue; // unfinished / cooldown children: counted nowhere (Form's rule) — not "skipped"
    if (!isYmd(raw.date)) { skipped.sessions++; continue; }
    const id = typeof raw.id === 'string' && raw.id ? raw.id : `s-${raw.date}-${sessions.length}`;
    if (dupes.has(id)) { skipped.sessions++; continue; }
    dupes.add(id);

    const sets = [];
    const groups = { push: 0, pull: 0, legs: 0, core: 0 };
    let exerciseCount = 0;
    let volume = 0;
    for (const entry of Array.isArray(raw.entries) ? raw.entries : []) {
      if (!entry || typeof entry.exerciseId !== 'string') continue;
      const rec = ex[entry.exerciseId] || null;
      const name = rec ? rec[0] : humanize(entry.exerciseId);
      const mode = rec ? rec[2] : null;
      const group = rec ? rec[3] : 'other';
      const flags = rec ? rec[4] || '' : '';
      const unilateral = flags.includes('u');
      const assisted = flags.includes('a') || /assist/i.test(entry.exerciseId);
      let kept = 0;
      for (const s of Array.isArray(entry.sets) ? entry.sets : []) {
        if (!s || s.warmup === true) continue;
        const reps = unilateral ? (num(s.reps) != null && num(s.rightReps) != null ? Math.min(s.reps, s.rightReps) : null) : num(s.reps);
        const weight = num(s.weight);
        if (reps == null || reps <= 0) continue; // a set with no reps was planned, not done
        const known = mode != null;
        const lift = !assisted && weight != null && weight > 0 && (known ? LOADED_MODES.has(mode) : !UNLOADED_ID.test(entry.exerciseId));
        sets.push({ exercise: name, exerciseId: entry.exerciseId, reps, weight: weight != null && weight > 0 ? weight : null, lift });
        kept++;
        if (groups[group] != null) groups[group]++;
        if (lift && weight > 0 && reps > 0) volume += weight * reps;
      }
      if (kept) exerciseCount++;
    }
    const hasCardioBlock = Array.isArray(raw.blocks) && raw.blocks.some((b) => b && b.cardio && num(b.cardio.minutes) > 0);
    const kind = classify(raw, groups, hasCardioBlock);
    const focus = focusFromGroups(groups);
    const title = (raw.workout && typeof raw.workout.name === 'string' && raw.workout.name.trim())
      || programDayLabel(raw, obj.program)
      || (kind === 'mobility' ? 'Mobility' : kind === 'cardio' ? 'Cardio' : FOCUS_TITLE[focus])
      || 'Workout';
    const durationMin = measuredMinutes(raw);
    const at = String(raw.finishedAt || raw.startedAt || raw.createdAt || '');
    sessions.push({
      id, date: raw.date, at, title: String(title).slice(0, 60), focus, kind, durationMin,
      exercises: exerciseCount, setCount: sets.length, volume: Math.round(volume), groups, sets,
    });
    if (durationMin) addActive(raw.date, durationMin);
  }
  sessions.sort((a, b) => (a.date === b.date ? (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1) : a.date < b.date ? -1 : 1));

  let dayCount = 0;
  for (const d of Array.isArray(obj.days) ? obj.days : []) {
    if (!d || !isYmd(d.date)) { skipped.days++; continue; }
    dayCount++;
    for (const a of Array.isArray(d.activities) ? d.activities : []) {
      const minutes = posInt(a && a.minutes);
      if (!minutes || minutes > MAX_ACTIVITY_MIN || typeof a.activityId !== 'string') continue;
      activityLog.push({ date: d.date, id: a.activityId, name: act[a.activityId] || humanize(a.activityId), minutes });
      addActive(d.date, minutes);
    }
    for (const c of Array.isArray(d.cardio) ? d.cardio : []) {
      const minutes = posInt(c && c.minutes);
      if (!minutes || minutes > MAX_ACTIVITY_MIN) continue;
      activityLog.push({ date: d.date, id: 'cardio', name: c.kind === 'interval' ? 'Intervals' : 'Cardio', minutes });
      addActive(d.date, minutes);
    }
    let mob = posInt(d.mobilityMinutes) || 0;
    for (const g of Array.isArray(d.guidedMobility) ? d.guidedMobility : []) {
      let secs = 0;
      for (const r of Array.isArray(g && g.results) ? g.results : []) secs += num(r && r.practicedSeconds) > 0 ? r.practicedSeconds : 0;
      mob += Math.round(secs / 60);
    }
    if (mob > 0 && mob <= MAX_ACTIVITY_MIN) mobilityByDay[d.date] = (mobilityByDay[d.date] || 0) + mob;
  }
  activityLog.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // as-of: the export's own timestamp; if it is missing, the newest thing in the file (end of that day)
  let asOf = typeof obj.exportedAt === 'string' && !Number.isNaN(Date.parse(obj.exportedAt)) ? new Date(obj.exportedAt).toISOString() : null;
  if (!asOf) {
    const newest = [sessions.length ? sessions[sessions.length - 1].date : null, ...Object.keys(activeByDay)].filter(Boolean).sort().pop();
    asOf = newest ? new Date(`${newest}T23:59:00`).toISOString() : now.toISOString();
  }
  const profile = {};
  const p = obj.profile && typeof obj.profile === 'object' ? obj.profile : {};
  if (num(p.cardioTarget) > 0) profile.cardioTarget = Math.round(p.cardioTarget);
  if (num(p.stepsTarget) > 0) profile.stepsTarget = Math.round(p.stepsTarget);

  const dataset = {
    v: DATASET_VERSION,
    source: FORMAT,
    asOf,
    asOfDate: localDate(asOf),
    importedAt: now.toISOString(),
    fileName: fileName ? String(fileName).slice(0, 120) : null,
    member: { id: obj.member && typeof obj.member.id === 'string' ? obj.member.id : null, name: obj.member && typeof obj.member.displayName === 'string' ? obj.member.displayName.slice(0, 40) : '' },
    profile,
    sessions,
    activeMinutesByDay: activeByDay,
    activityLog,
    mobilityByDay,
    counts: { sessions: sessions.length, days: dayCount, activities: activityLog.length, skippedSessions: skipped.sessions, skippedDays: skipped.days },
  };
  return { ok: true, dataset, skipped };
}

/** A one-line description of a stored dataset for lists and toasts. */
export function describeDataset(ds) {
  if (!ds) return 'Not imported yet';
  const n = Array.isArray(ds.sessions) ? ds.sessions.length : 0;
  return `${n} ${n === 1 ? 'session' : 'sessions'}`;
}

/** 'Sat, Sep 27' for a YYYY-MM-DD. */
export function longDate(date) {
  if (!isYmd(date)) return '';
  const d = parseYmd(date);
  return `${DOW_LONG[dowIndex(date)].slice(0, 3)}, ${MONTHS_LONG[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
}
