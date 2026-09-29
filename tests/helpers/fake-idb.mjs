// A tiny in-memory IndexedDB for Node tests — only what js/store.js uses: open/upgrade, object stores with
// keyPath and simple indexes, transactions that commit when idle and roll back on abort, and the request
// methods get / getAll / getAllKeys / put / delete / clear / count / index().getAll. Values are structured-cloned
// in and out like the real thing, and put() throws DataError synchronously for a row missing its key (which is
// what makes store.replaceAll atomic).
//
//   import { install } from './helpers/fake-idb.mjs';  install();   // sets globalThis.indexedDB + IDBKeyRange

const dbs = new Map();

const clone = (v) => (v === undefined ? v : structuredClone(v));
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

class Request {
  constructor() { this.result = undefined; this.error = null; this.onsuccess = null; this.onerror = null; }
}

class Tx {
  constructor(db, names, mode) {
    this.db = db; this.names = names; this.mode = mode;
    this.pending = 0; this.done = false; this.error = null;
    this.oncomplete = null; this.onerror = null; this.onabort = null;
    this.snap = mode === 'readonly' ? null : new Map(names.map((n) => [n, new Map(db.stores.get(n).rows)]));
    this.check();
  }
  check() { setTimeout(() => { if (!this.done && this.pending === 0) { this.done = true; this.oncomplete && this.oncomplete({}); } }, 0); }
  abort() {
    if (this.done) return;
    this.done = true;
    if (this.snap) for (const [n, rows] of this.snap) this.db.stores.get(n).rows = rows;
    setTimeout(() => this.onabort && this.onabort({}), 0);
  }
  objectStore(name) {
    if (!this.names.includes(name)) throw new Error(`NotFoundError: ${name}`);
    return new ObjectStore(this, this.db.stores.get(name));
  }
  run(fn) {
    const r = new Request();
    this.pending++;
    setTimeout(() => {
      if (!this.done) {
        try { r.result = fn(); r.onsuccess && r.onsuccess({ target: r }); } catch (e) { r.error = e; r.onerror && r.onerror({ target: r }); }
      }
      this.pending--;
      this.check();
    }, 0);
    return r;
  }
}

const inRange = (k, range) => !range || ((range.lower === undefined || k >= range.lower) && (range.upper === undefined || k <= range.upper));

class ObjectStore {
  constructor(tx, store) { this.tx = tx; this.s = store; }
  get indexNames() { return { contains: (n) => this.s.indexes.has(n) }; }
  createIndex(name, keyPath) { this.s.indexes.set(name, keyPath); }
  index(name) {
    const kp = this.s.indexes.get(name);
    return { getAll: (range) => this.tx.run(() => [...this.s.rows.values()].filter((v) => inRange(v[kp], range)).sort((a, b) => cmp(a[kp], b[kp])).map(clone)) };
  }
  get(key) { return this.tx.run(() => clone(this.s.rows.get(key))); }
  getAll() { return this.tx.run(() => [...this.s.rows.entries()].sort((a, b) => cmp(a[0], b[0])).map(([, v]) => clone(v))); }
  getAllKeys() { return this.tx.run(() => [...this.s.rows.keys()].sort()); }
  count() { return this.tx.run(() => this.s.rows.size); }
  put(value) {
    const key = value && value[this.s.keyPath];
    if (key === undefined || key === null || key === '') throw new Error('DataError: the row has no key');
    return this.tx.run(() => { this.s.rows.set(key, clone(value)); return key; });
  }
  delete(key) { return this.tx.run(() => { this.s.rows.delete(key); }); }
  clear() { return this.tx.run(() => { this.s.rows.clear(); }); }
}

class Database {
  constructor(name, version) { this.name = name; this.version = version; this.stores = new Map(); this.onversionchange = null; }
  get objectStoreNames() { return { contains: (n) => this.stores.has(n) }; }
  createObjectStore(name, { keyPath }) {
    this.stores.set(name, { keyPath, indexes: new Map(), rows: new Map() });
    return new ObjectStore({ run: () => new Request() }, this.stores.get(name));
  }
  transaction(names, mode = 'readonly') { return new Tx(this, Array.isArray(names) ? names : [names], mode); }
  close() {}
}

export const fakeIndexedDB = {
  open(name, version) {
    const req = new Request();
    req.onupgradeneeded = null; req.onblocked = null; req.transaction = null;
    setTimeout(() => {
      let db = dbs.get(name);
      const upgrade = !db || (version && version > db.version);
      if (!db) { db = new Database(name, version || 1); dbs.set(name, db); }
      req.result = db;
      if (upgrade) {
        db.version = version || 1;
        req.transaction = { objectStore: (n) => new ObjectStore({ run: () => new Request() }, db.stores.get(n)) };
        req.onupgradeneeded && req.onupgradeneeded({ target: req });
      }
      req.onsuccess && req.onsuccess({ target: req });
    }, 0);
    return req;
  },
};

export const FakeKeyRange = {
  bound: (lower, upper) => ({ lower, upper }),
  lowerBound: (lower) => ({ lower }),
  upperBound: (upper) => ({ upper }),
};

/** Reset every database (between test groups). */
export function reset() { dbs.clear(); }

export function install() {
  globalThis.indexedDB = fakeIndexedDB;
  globalThis.IDBKeyRange = FakeKeyRange;
}

/** A Map-backed localStorage (Node has none) for the parts of backup.js that touch vendored keys. */
export function installLocalStorage() {
  const m = new Map();
  globalThis.localStorage = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    get length() { return m.size; },
  };
  return m;
}
