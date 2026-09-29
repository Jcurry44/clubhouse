// Train — the import flow, on the shell's own machinery: pick a Form export → validate → preview sheet (the shell's
// confirm) → an automatic snapshot BEFORE anything is written → save → toast with Undo. Nothing here touches Form.
//
//   importFromFile(file) → { ok:true, dataset } | { ok:false, cancelled?:true, reason? }
//
// The preview shows Now → File for sessions / days / activities, warns when the file is older than what is already
// here or belongs to a different Form member, and never writes until the person taps "Import".
import * as backup from '../backup.js';
import { confirm, toast } from '../ui.js';
import { stamp, monD } from '../dates.js';
import { parseFormExport, loadCatalog, EXPORT_HINT } from './form-import.js';
import { loadDataset, saveDataset } from './data.js';

const MAX_BYTES = 30 * 1024 * 1024;
export const SNAPSHOT_LABEL = 'before-form-import';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Preview rows for the confirm table: what is stored now vs what the file would bring. */
export function previewRows(current, dataset) {
  const c = dataset.counts || {};
  const cur = current ? { sessions: current.sessions.length, days: (current.counts && current.counts.days) || 0, activities: (current.activityLog || []).length } : { sessions: 0, days: 0, activities: 0 };
  return [
    { label: 'Sessions', now: cur.sessions, file: dataset.sessions.length },
    { label: 'Days logged', now: cur.days, file: c.days || 0 },
    { label: 'Activities', now: cur.activities, file: (dataset.activityLog || []).length },
  ];
}

/** Title + sub for the preview, including the "older file" and "someone else's file" cautions. */
export function previewText(current, dataset) {
  const who = (dataset.member && dataset.member.name) || 'Form';
  const asOf = `as of ${stamp(dataset.asOf)}`;
  const older = Boolean(current && current.asOf && dataset.asOf < current.asOf);
  const other = Boolean(current && current.member && current.member.id && dataset.member.id && current.member.id !== dataset.member.id);
  let title = 'Import this Form export?';
  let sub = `${who} · ${asOf}`;
  if (other) {
    title = `Import ${who}’s export?`;
    sub = `This file is from a different Form member than the one you imported before (${current.member.name || 'someone'}). ${asOf}.`;
  } else if (older) {
    title = 'This export is older — import anyway?';
    sub = `${who} · ${asOf}. You already have data as of ${monD(current.asOfDate)}.`;
  }
  return { title, sub, older, other };
}

export async function importFromFile(file) {
  if (!file) return { ok: false, cancelled: true };
  if (file.size > MAX_BYTES) { toast('That file is too big to be a Form export.', { tone: 'warm' }); return { ok: false, reason: 'size' }; }
  let text;
  try { text = await file.text(); } catch { toast('Couldn’t read that file.', { tone: 'warm' }); return { ok: false, reason: 'read' }; }
  let obj;
  try { obj = JSON.parse(text); } catch {
    toast(`That isn’t a Form export (it isn’t JSON). ${EXPORT_HINT}`, { tone: 'warm', duration: 7000 });
    return { ok: false, reason: 'json' };
  }
  const catalog = await loadCatalog();
  const parsed = parseFormExport(obj, { catalog, fileName: file.name });
  if (!parsed.ok) { toast(parsed.message, { tone: 'warm', duration: 7000 }); return { ok: false, reason: parsed.reason }; }
  const { dataset } = parsed;

  const current = await loadDataset();
  const { title, sub } = previewText(current, dataset);
  const go = await confirm({
    title, sub,
    rows: previewRows(current, dataset),
    cols: ['Now', 'File'],
    verb: 'Import', tone: 'volt', glyph: 'import',
  });
  if (!go) return { ok: false, cancelled: true };

  let snap;
  try { snap = await backup.snapshot(SNAPSHOT_LABEL); } catch (err) {
    console.warn('snapshot failed', err);
    toast('Couldn’t snapshot — nothing changed.', { tone: 'warm' });
    return { ok: false, reason: 'snapshot' };
  }
  try { await saveDataset(dataset); } catch (err) {
    console.warn('import failed', err);
    toast('Couldn’t save that. Your snapshot is in Backups.', { tone: 'warm' });
    return { ok: false, reason: 'write' };
  }
  window.dispatchEvent(new Event('clubhouse:refresh'));
  const n = dataset.sessions.length;
  toast(`Imported · ${plural(n, 'session', 'sessions')} · as of ${monD(dataset.asOfDate)}`, {
    icon: 'import',
    action: {
      label: 'Undo',
      run: async () => {
        try {
          await backup.restoreSnapshot(snap.id, 'before-undo');
          toast('Undone — Train is back how it was.', { icon: 'restore' });
        } catch (err) {
          console.warn(err);
          toast('Couldn’t undo. Your snapshot is still in Backups.', { tone: 'warm' });
        }
      },
    },
  });
  return { ok: true, dataset };
}
