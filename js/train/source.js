// Train — the trainSource adapter seam (DECISIONS 2026-09-28).
//
//   interface TrainSource {
//     id: string; label: string;
//     enabled: boolean;                       // false → shown greyed out in Settings with `note`
//     note?: string;
//     load(): Promise<{ dataset: NormalizedDataset | null, asOf: string | null }>;
//   }
//
// v1 implements fileSource (the dataset the person imported from Form's Export file, read back from IndexedDB).
// A later liveSource would fetch a read-only summary from Form with a Bearer token — that needs a new route in
// Form (CORS-allowing only https://jcurry44.github.io) and Joe's approval to redeploy Form, so it is NOT built.
// Whatever a source returns must be the same NormalizedDataset shape (form-import.js parseFormExport), and the
// rest of Train (model.js, the pillar, the screens) does not care where it came from.
import { loadDataset } from './data.js';

export const fileSource = {
  id: 'file',
  label: 'Form export file',
  enabled: true,
  async load() {
    const dataset = await loadDataset();
    return { dataset, asOf: dataset ? dataset.asOf : null };
  },
};

export const liveSource = {
  id: 'live',
  label: 'Connect live',
  enabled: false,
  note: 'Later — needs a read-only route added to Form first.',
  async load() {
    const err = new Error('The live Form source is not available yet.');
    err.code = 'not-available';
    throw err;
  },
};

export const sources = [fileSource, liveSource];

/** The source Train reads from. v1: always the imported file. */
export function activeSource() {
  return fileSource;
}
