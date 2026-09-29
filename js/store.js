// Clubhouse — IndexedDB wrapper (SPEC §3.1). DB `clubhouse`, version 1.
// Every write emits store.events 'change' { detail: { store, key } } after its transaction commits.

export const DB_NAME = 'clubhouse';
export const DB_VERSION = 2; // v2: + trainForm (the imported Form dataset) — additive, nothing else changes

/** Schema: store → { keyPath, indexes: [[name, keyPath]] }. Additive migrations only. */
export const SCHEMA = {
  workouts: { keyPath: 'id', indexes: [['date', 'date'], ['templateId', 'templateId']] },
  exercises: { keyPath: 'id', indexes: [['kind', 'kind']] },
  templates: { keyPath: 'id', indexes: [] },
  prs: { keyPath: 'id', indexes: [['exerciseId', 'exerciseId']] },
  pours: { keyPath: 'id', indexes: [['date', 'date']] },
  watched: { keyPath: 'gameId', indexes: [['date', 'date']] },
  trainForm: { keyPath: 'key', indexes: [] }, // Train lane: one row {key:'dataset', …} — the Form export, normalized (js/train/data.js)
  settings: { keyPath: 'key', indexes: [] },
  snapshots: { keyPath: 'id', indexes: [] },
};
export const STORE_NAMES = Object.keys(SCHEMA);
/** Stores that belong in a backup (snapshots never do). Order = backup file order. */
export const DATA_STORES = ['workouts', 'exercises', 'templates', 'prs', 'pours', 'watched', 'trainForm', 'settings'];

/** Goal defaults = the pillars' meta.defaultGoal (SPEC §2). Kept here to avoid a pillars ↔ store import cycle. */
export const DEFAULT_GOALS = { golf: 2, train: 5, bourbon: 3, sports: 3 };
export const GOAL_RANGE = { min: 1, max: 14 };

export const events = new EventTarget();

let dbPromise = null;

/** Idempotent open. Rejects (once, memoized) when IndexedDB is unavailable — main.js shows the storage panel. */
export function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) throw new Error('IndexedDB unavailable');
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      const tx = req.transaction;
      for (const [name, def] of Object.entries(SCHEMA)) {
        const os = db.objectStoreNames.contains(name) ? tx.objectStore(name) : db.createObjectStore(name, { keyPath: def.keyPath });
        for (const [idx, path] of def.indexes) {
          if (!os.indexNames.contains(idx)) os.createIndex(idx, path, { unique: false });
        }
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB open blocked by another tab'));
  });
  return dbPromise;
}

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

/**
 * Run fn(tx) in one transaction; resolves with fn's (awaited-in-tx) result after commit.
 * Aborts (and rejects) if fn throws synchronously.
 */
export async function tx(names, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    let t, result;
    try {
      t = db.transaction(names, mode);
    } catch (err) { reject(err); return; }
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error || new Error('transaction failed'));
    t.onabort = () => reject(t.error || new Error('transaction aborted'));
    try {
      Promise.resolve(fn(t)).then((r) => { result = r; }, (err) => { try { t.abort(); } catch { /* already done */ } reject(err); });
    } catch (err) {
      try { t.abort(); } catch { /* already done */ }
      reject(err);
    }
  });
}

function emit(store, key) {
  events.dispatchEvent(new CustomEvent('change', { detail: { store, key } }));
}

export async function get(store, key) {
  return tx(store, 'readonly', (t) => reqP(t.objectStore(store).get(key)));
}

/** opts: { index, lower, upper } → IDBKeyRange.bound(lower, upper) on that index. */
export async function getAll(store, opts = {}) {
  return tx(store, 'readonly', (t) => {
    let src = t.objectStore(store);
    if (opts.index) src = src.index(opts.index);
    let range;
    if (opts.lower != null && opts.upper != null) range = IDBKeyRange.bound(opts.lower, opts.upper);
    else if (opts.lower != null) range = IDBKeyRange.lowerBound(opts.lower);
    else if (opts.upper != null) range = IDBKeyRange.upperBound(opts.upper);
    return reqP(src.getAll(range));
  });
}

export async function put(store, value) {
  const key = await tx(store, 'readwrite', (t) => reqP(t.objectStore(store).put(value)));
  emit(store, key);
  return key;
}

export async function putMany(store, values) {
  await tx(store, 'readwrite', (t) => {
    const os = t.objectStore(store);
    for (const v of values) os.put(v);
  });
  emit(store, null);
  return values.length;
}

export async function del(store, key) {
  await tx(store, 'readwrite', (t) => reqP(t.objectStore(store).delete(key)));
  emit(store, key);
}

/** Internal — only backup.js may call it (inside replaceAll-style restores). */
export async function clear(store) {
  await tx(store, 'readwrite', (t) => reqP(t.objectStore(store).clear()));
  emit(store, null);
}

export async function count(store) {
  return tx(store, 'readonly', (t) => reqP(t.objectStore(store).count()));
}

/** clear + putMany in ONE transaction (import only). Any bad row aborts → store unchanged. */
export async function replaceAll(store, rows) {
  await tx(store, 'readwrite', (t) => {
    const os = t.objectStore(store);
    os.clear();
    for (const r of rows) os.put(r); // throws DataError synchronously on a row without its key → abort
  });
  emit(store, null);
  return rows.length;
}

/** Every data store in one read transaction (a consistent picture). Snapshots omitted. */
export async function dumpAll() {
  return tx(DATA_STORES, 'readonly', async (t) => {
    const out = {};
    const reads = DATA_STORES.map((s) => reqP(t.objectStore(s).getAll()).then((rows) => { out[s] = rows; }));
    await Promise.all(reads);
    return out;
  });
}

/** { workouts: n, … } for every data store. */
export async function counts() {
  return tx(DATA_STORES, 'readonly', async (t) => {
    const out = {};
    await Promise.all(DATA_STORES.map((s) => reqP(t.objectStore(s).count()).then((n) => { out[s] = n; })));
    return out;
  });
}

export async function setting(key, fallback) {
  const row = await get('settings', key);
  return row && row.value !== undefined ? row.value : fallback;
}

export async function setSetting(key, value) {
  return put('settings', { key, value });
}

/** All settings as a plain object { key: value }. */
export async function settingsMap() {
  const rows = await getAll('settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** { golf, train, bourbon, sports } from settings, clamped 1–14, with the pillar defaults. */
export async function goals() {
  const map = await settingsMap();
  const out = {};
  for (const [p, d] of Object.entries(DEFAULT_GOALS)) {
    const v = Number(map[`goal.${p}`]);
    out[p] = Number.isInteger(v) && v >= GOAL_RANGE.min && v <= GOAL_RANGE.max ? v : d;
  }
  return out;
}

/**
 * Snapshot insert with the rolling cap in the SAME transaction (SPEC §3.7): keep the `keep` newest.
 * Snapshot ids are `snap-<base36 ms>-<rand>`, so key order is time order.
 */
export async function addSnapshot(row, keep = 5) {
  await tx('snapshots', 'readwrite', async (t) => {
    const os = t.objectStore('snapshots');
    os.put(row);
    const keys = await reqP(os.getAllKeys());
    const sorted = keys.slice().sort();
    for (const k of sorted.slice(0, Math.max(0, sorted.length - keep))) os.delete(k);
  });
  emit('snapshots', row.id);
  return row.id;
}
