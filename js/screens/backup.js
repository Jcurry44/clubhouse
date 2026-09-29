// Backups (#/backup) — SPEC §3.5–3.8, §7.9. Export (Web Share / download), import with preview +
// confirm + automatic snapshot, hand-off for Fairway Ledger / Barrel Proof files, snapshot list + restore.
import * as store from '../store.js';
import * as backup from '../backup.js';
import { h, icon, mount as fill, fmt } from '../dom.js';
import { ago, stamp, monD, ymd } from '../dates.js';
import { toast, confirm } from '../ui.js';

export const title = 'Backups';

const LEDGER = './apps/fairway-ledger/index.html';
const BP = './apps/barrel-proof/index.html';

export function snapLabel(label) {
  const map = {
    'before-import': 'Before an import', 'before-restore': 'Before a restore', 'before-undo': 'Before an undo',
    'before-unwatch': 'Before unmarking games', 'before-reset-goals': 'Before a goal reset',
    'before-delete-workout': 'Before deleting a workout', 'before-delete-pour': 'Before deleting a pour',
    'before-form-import': 'Before Form import',
    'before-barrel-proof-restore': 'Before a Barrel Proof restore', 'before-barrel-proof-reset': 'Before a Barrel Proof reset',
  };
  if (map[label]) return map[label];
  const s = String(label || 'Snapshot').replace(/^before-/, 'before ').replace(/-/g, ' ');
  return s[0].toUpperCase() + s.slice(1);
}

function countsLine(c = {}) {
  const parts = [];
  parts.push(`${c.rounds || 0} ${c.rounds === 1 ? 'round' : 'rounds'}`);
  parts.push(`${c.workouts || 0} ${c.workouts === 1 ? 'workout' : 'workouts'}`);
  if (c.tastings) parts.push(`${c.tastings} ${c.tastings === 1 ? 'tasting' : 'tastings'}`);
  if (c.pours) parts.push(`${c.pours} ${c.pours === 1 ? 'pour' : 'pours'}`);
  return parts.join(' · ');
}

/** Run a restore with the Undo toast; used by import and snapshot restore. */
async function doRestore(run, doneText, navigate) {
  try {
    const res = await run();
    navigate('#/');
    const undoId = res.snap.id;
    toast(doneText(res), {
      icon: 'restore',
      action: {
        label: 'Undo',
        run: async () => {
          try {
            await backup.restoreSnapshot(undoId, 'before-undo');
            toast('Undone — everything is back how it was.', { icon: 'restore' });
          } catch (err) {
            console.warn(err);
            toast('Couldn’t undo. Your snapshot is still in Backups.', { tone: 'warm' });
          }
        },
      },
    });
  } catch (err) {
    console.warn('restore failed', err);
    if (err.code === 'snapshot') toast('Couldn’t snapshot — nothing changed.', { tone: 'warm' });
    else if (err.code === 'invalid') toast('That backup looks damaged — nothing changed.', { tone: 'warm' });
    else toast('Restore stopped partway. Your pre-restore snapshot is in Backups.', { tone: 'warm' });
  }
}

export async function mount(el, params, ctx) {
  const navigate = ctx.navigate || ((to) => { location.hash = to; });
  let alive = true;
  let handoff = null; // { kind, text }

  const fileInput = h('input.file-input', { type: 'file', accept: 'application/json,.json', tabindex: '-1', 'aria-hidden': 'true' });

  async function onFile(file) {
    if (!file) return;
    let text;
    try { text = await file.text(); } catch { toast('Couldn’t read that file.', { tone: 'warm' }); return; }
    let obj;
    try { obj = JSON.parse(text); } catch { toast('That file isn’t JSON', { tone: 'warm' }); return; }
    const kind = backup.detect(obj);
    if (kind === 'fairway-ledger') {
      handoff = { kind, title: 'A Fairway Ledger backup', text: `${obj.rounds.length} ${obj.rounds.length === 1 ? 'round' : 'rounds'}, ${obj.courses.length} ${obj.courses.length === 1 ? 'course' : 'courses'}. Bring it in through the ledger’s own Import — it takes its own safety snapshot first.`, cta: 'Open Fairway Ledger', href: LEDGER };
      draw();
      return;
    }
    if (kind === 'barrel-proof') {
      const st = obj.state || {};
      const tastings = Array.isArray(st.tastings) ? st.tastings.length : 0;
      const open = Object.entries(st.statuses || {}).filter(([id, s]) => s === 'owned' && Number(st.collection?.[id]?.count) > 0).length;
      handoff = { kind, title: 'A Barrel Proof backup', text: `${tastings} ${tastings === 1 ? 'tasting' : 'tastings'}, ${open} on the shelf. Bring it in with Barrel Proof’s Restore (the upload arrow). Clubhouse snapshots everything first, so you can undo it here.`, cta: 'Open Barrel Proof', href: BP };
      draw();
      return;
    }
    if (kind === 'unknown' && obj && typeof obj.format === 'string' && /^form-v\d+$/.test(obj.format)) {
      // repair: a Form export belongs to Train — run Train's own import (preview → snapshot → Undo) on this same file
      const flow = await import('../train/import-flow.js');
      const res = await flow.importFromFile(file);
      if (res && res.ok) navigate('#/train');
      return;
    }
    if (kind !== 'clubhouse') { toast('Not a Clubhouse, Fairway Ledger, Barrel Proof or Form file.', { tone: 'warm' }); return; }
    const problem = backup.validate(obj);
    if (problem) { toast('That backup looks damaged — nothing changed.', { tone: 'warm' }); return; }
    const [now, file2] = [await backup.nowCounts(), backup.fileCounts(obj)];
    const ok = await confirm({
      title: 'Restore this backup?',
      sub: `From ${obj.device || 'another device'} · ${stamp(obj.exportedAt)}`,
      rows: backup.previewRows(now, file2),
      cols: ['Now', 'File'],
      verb: 'Replace everything',
      glyph: 'restore',
    });
    if (!ok) return;
    await doRestore(() => backup.restore(obj, 'before-import'), (res) => `Restored · ${res.counts.rounds ?? 0} rounds · ${res.counts.workouts ?? 0} workouts`, navigate);
  }
  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    onFile(f);
  });

  async function restoreSnap(meta) {
    const row = await backup.getSnapshot(meta.id);
    if (!row) { toast('That snapshot is gone.', { tone: 'warm' }); draw(); return; }
    const now = await backup.nowCounts();
    const day = monD(ymd(new Date(meta.at)));
    const ok = await confirm({
      title: `Restore ${day} snapshot?`,
      sub: `${snapLabel(meta.label)} · ${stamp(meta.at)}`,
      rows: backup.previewRows(now, backup.fileCounts(row.payload)),
      cols: ['Now', 'Snapshot'],
      verb: `Restore ${day} snapshot`,
      glyph: 'restore',
    });
    if (!ok) return;
    await doRestore(() => backup.restoreSnapshot(meta.id, 'before-restore'), () => `Restored the ${day} snapshot`, navigate);
  }

  function exportTap(btn) {
    btn.classList.add('busy');
    backup.exportNow().then((res) => {
      btn.classList.remove('busy');
      toast(res.message, { tone: res.ok ? 'good' : 'warm', icon: res.ok ? 'check' : res.cancelled ? 'x' : 'warn' });
    }).catch((err) => {
      btn.classList.remove('busy');
      console.warn(err);
      toast('Couldn’t build the backup. Nothing changed.', { tone: 'warm' });
    });
  }

  async function draw() {
    const [last, now, snaps, map] = await Promise.all([backup.lastExport(), backup.nowCounts(), backup.listSnapshots(), store.settingsMap()]);
    if (!alive) return;
    backup.prepare().catch(() => {});
    const age = last ? ago(last.at) : null;
    const stale = !last || Date.now() - new Date(last.at) > backup.NUDGE_DAYS * 864e5;
    const snoozed = map['backup.snoozedUntil'] && new Date(map['backup.snoozedUntil']) > new Date();
    const exportBtn = h('button.cta', { type: 'button', onclick: (e) => exportTap(e.currentTarget) }, icon('share'), 'Back up now');
    const importBtn = h('button.cta.quiet.sm', { type: 'button', onclick: () => fileInput.click() }, icon('import'), 'Import a backup');

    fill(el,
      h('header.rise',
        h('div.subtop', h('a.back', { href: '#/settings' }, icon('chevl'), 'Settings'), h('span')),
        h('h1.title', icon('shield'), 'Backups'),
        h('div.eyebrow', { style: 'margin-top:6px' }, 'Everything on this phone, in one file'),
      ),
      h('section.card.backup-hero.rise',
        h('div.state',
          h('div', { class: `mark${stale ? ' warm' : ''}` }, icon(stale ? 'warn' : 'shield')),
          h('div',
            h('div.k', 'Last backup'),
            h('div.v', last ? age[0].toUpperCase() + age.slice(1) : h('span.warn', 'Never backed up'), last && stale ? h('span.warn', ' · due') : null),
          ),
        ),
        h('div.counts',
          [['rounds', 'Rounds'], ['workouts', 'Workouts'], ['tastings', 'Tastings'], ['pours', 'Pours']].map(([k, label]) => h('div', h('b', String(now[k] || 0)), h('span', label))),
        ),
        h('p.copy', 'A backup is one file with everything: rounds, workouts, pours, watched games, settings, and your Fairway Ledger and Barrel Proof data.'),
        exportBtn,
        h('div.row2', importBtn),
        snoozed && stale ? h('p.copy', { style: 'margin-top:10px;font-size:12.5px;color:var(--ink-3)' }, 'Reminder snoozed until ', monD(ymd(new Date(map['backup.snoozedUntil']))), '.') : null,
        fileInput,
      ),
      handoff ? h('section.card.handoff.rise', { role: 'status' },
        h('button.close', { type: 'button', 'aria-label': 'Dismiss', onclick: () => { handoff = null; draw(); } }, icon('x')),
        h('div.empty',
          h('div.glyph', icon(handoff.kind === 'fairway-ledger' ? 'golf' : 'bourbon')),
          h('div', h('h3', handoff.title), h('p', handoff.text), h('p', { style: 'color:var(--ink-3);font-size:12.5px' }, 'Nothing was written here.'),
            h('div.btns', h('a.pill.sel', { href: handoff.href }, handoff.cta, icon('chev')))),
        ),
      ) : null,
      h('div.section-h.rise', h('h2', 'Snapshots'), h('span.meta', 'Automatic · newest 5')),
      snaps.length
        ? h('section.card.list.snaps.rise', snaps.map((s) => h('div.li',
          h('div.lg', icon('restore')),
          h('div.t', h('b', snapLabel(s.label)), h('small', `${stamp(s.at)} · ${countsLine(s.counts)}`)),
          h('div.end', h('button.pill', { type: 'button', onclick: () => restoreSnap(s) }, 'Restore')),
        )))
        : h('section.card.rise', h('div.empty',
          h('div.glyph', icon('shield')),
          h('div', h('h3', 'No snapshots yet'), h('p', 'One is taken automatically before anything destructive.')),
        )),
    );
  }

  await draw();
  el.classList.add('no-rise'); // later redraws update in place; the entrance plays once per visit
  const onChange = (e) => { if (alive && e?.detail?.store && ['snapshots', 'settings'].includes(e.detail.store)) draw(); };
  store.events.addEventListener('change', onChange);
  return () => { alive = false; store.events.removeEventListener('change', onChange); };
}

export { fmt };
