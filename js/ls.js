// Clubhouse — vendored-app localStorage readers (SPEC §3.3). Lane B (golf-bourbon) owns this file.
// Same origin + same PWA scope ⇒ the vendored apps' localStorage is literally shared. Reads are memoized on the
// raw string; writes/removals are allowed only for VENDORED_KEYS and only from backup restore + the dev sample toggle.

export const VENDORED_KEYS = [
  'fairwayLedger.v1',
  'fairwayLedger.backupMeta.v1',
  'fairwayLedger.inProgressRound.v1',
  'fairwayLedger.games.v1',
  'fairwayLedger.gamePlayerNames.v1',
  'barrel-proof-state-v1',
];

export function readRaw(key) {
  try { return globalThis.localStorage ? localStorage.getItem(key) : null; } catch { return null; }
}

/** Only backup.js restore paths call this. Never writes outside VENDORED_KEYS. */
export function writeRaw(key, value) {
  if (!VENDORED_KEYS.includes(key)) throw new Error(`refusing to write non-vendored key ${key}`);
  localStorage.setItem(key, String(value));
}

/** Removes one vendored key (only the dev sample-data toggle uses it, after a snapshot). Never outside VENDORED_KEYS. */
export function removeRaw(key) {
  if (!VENDORED_KEYS.includes(key)) throw new Error(`refusing to remove non-vendored key ${key}`);
  localStorage.removeItem(key);
}

const memo = new Map(); // key → { raw, parsed }
function parseMemo(key) {
  const raw = readRaw(key);
  const hit = memo.get(key);
  if (hit && hit.raw === raw) return hit.parsed;
  let parsed;
  if (raw == null) parsed = { ok: false, reason: 'missing' };
  else {
    try { parsed = { ok: true, value: JSON.parse(raw) }; } catch { parsed = { ok: false, reason: 'parse' }; }
  }
  memo.set(key, { raw, parsed });
  return parsed;
}

export function readFairwayLedger() {
  const p = parseMemo('fairwayLedger.v1');
  if (!p.ok) return { ok: false, reason: p.reason };
  const state = p.value;
  if (!state || !Array.isArray(state.courses) || !Array.isArray(state.rounds)) return { ok: false, reason: 'shape' };
  const m = parseMemo('fairwayLedger.backupMeta.v1');
  const meta = m.ok && m.value && typeof m.value === 'object' ? m.value : {};
  return {
    ok: true,
    state,
    backupMeta: { lastExportAt: meta.lastExportAt ?? null, lastExportRoundCount: Number(meta.lastExportRoundCount) || 0 },
  };
}

export function readBarrelProof() {
  const p = parseMemo('barrel-proof-state-v1');
  if (!p.ok) return { ok: false, reason: p.reason };
  const state = p.value;
  if (!state || typeof state !== 'object' || !(Number(state.schemaVersion) >= 1) || typeof state.statuses !== 'object') return { ok: false, reason: 'shape' };
  return { ok: true, state };
}
