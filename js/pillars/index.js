// Pillar registry — order = ring order on Home (golf, train, bourbon, sports).
import * as golf from './golf.js';
import * as train from './train.js';
import * as bourbon from './bourbon.js';
import * as sports from './sports.js';

export const pillars = [golf, train, bourbon, sports];
export const byId = Object.fromEntries(pillars.map((p) => [p.id, p]));
