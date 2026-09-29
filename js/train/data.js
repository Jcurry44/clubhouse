// Train — persistence of the imported Form dataset in Clubhouse's own IndexedDB (store `trainForm`, one row
// keyed 'dataset'). The store is part of every full backup and snapshot (js/backup.js), so a restore brings the
// Train tab back exactly as it was. This file only reads and replaces that one row; the caller (import-flow.js)
// takes the automatic snapshot BEFORE saveDataset().
import * as store from '../store.js';

export const STORE = 'trainForm';
export const KEY = 'dataset';

/** The stored dataset (without its row key), or null when nothing was imported / the row is unusable. */
export async function loadDataset() {
  const row = await store.get(STORE, KEY);
  if (!row || !Array.isArray(row.sessions)) return null;
  const { key, ...dataset } = row;
  return dataset;
}

/** Replace the dataset. Emits store 'change' {store:'trainForm'} so open screens redraw. */
export async function saveDataset(dataset) {
  return store.put(STORE, { ...dataset, key: KEY });
}

/** { asOf, asOfDate, sessions, member, importedAt, fileName } | null — cheap description for Settings and the import preview. */
export async function loadMeta() {
  const ds = await loadDataset();
  if (!ds) return null;
  return { asOf: ds.asOf, asOfDate: ds.asOfDate, sessions: ds.sessions.length, member: ds.member || null, importedAt: ds.importedAt || null, fileName: ds.fileName || null };
}
