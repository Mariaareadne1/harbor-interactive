import { validOutline, parametricLoop, shapeFromLoop, type V2 } from '../boat/hull';
import { cleanName, nameFor } from '../boat/names';
import { MOORINGS, TILE } from '../scene/harbour';
import { mooringSpot, type Intent } from '../sail/sim';

/**
 * The persisted harbour: plain, versioned, immutable data. Each boat keeps
 * the outline it was drawn with (in its own frame), its seed, its name, where
 * it last was, and what it was last asked to do. Everything else — its trim,
 * its tack, its bob — is worked out live by the sailing simulation.
 */

export type Mode = 'free' | 'out' | 'home' | 'goto';

export interface BoatRecord {
  readonly id: string;
  readonly outline: readonly V2[];
  readonly seed: number;
  readonly name: string;
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly mode: Mode;
  /** Where it was sent (mode 'goto'). */
  readonly target: V2 | null;
}

export interface HarborDoc {
  readonly version: 1;
  readonly boats: readonly BoatRecord[];
}

export const DOC_VERSION = 1;
export const MAX_BOATS = 10;

export const emptyDoc = (): HarborDoc => ({ version: DOC_VERSION, boats: [] });

let counter = 0;
export function newBoatId(): string {
  counter = (counter + 1) % 1e6;
  return `b${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function newSeed(): number {
  return Math.floor(Math.random() * 1e6);
}

export const findBoat = (doc: HarborDoc, id: string) => doc.boats.find((b) => b.id === id) ?? null;

/** Add a boat; past the cap, the oldest one gives up its place. */
export function addBoat(doc: HarborDoc, boat: BoatRecord): HarborDoc {
  return { ...doc, boats: [...doc.boats, boat].slice(-MAX_BOATS) };
}

export function removeBoat(doc: HarborDoc, id: string): HarborDoc {
  return { ...doc, boats: doc.boats.filter((b) => b.id !== id) };
}

export function updateBoat(doc: HarborDoc, id: string, patch: Partial<Omit<BoatRecord, 'id'>>): HarborDoc {
  return { ...doc, boats: doc.boats.map((b) => (b.id === id ? { ...b, ...patch } : b)) };
}

export function intentOf(b: BoatRecord): Intent {
  if (b.mode === 'goto' && b.target) return { kind: 'goto', x: b.target[0], z: b.target[1] };
  if (b.mode === 'home') return { kind: 'home' };
  if (b.mode === 'out') return { kind: 'out' };
  return { kind: 'free' };
}

// --- validation -----------------------------------------------------------------------

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const within = (n: unknown, lim: number): n is number => finite(n) && Math.abs(n) <= lim;
const LIMIT_X = TILE.halfX + 2, LIMIT_Z = TILE.halfZ + 2;
const MODES: readonly Mode[] = ['free', 'out', 'home', 'goto'];

function parseBoat(raw: unknown): BoatRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || !/^[\w-]{1,64}$/.test(o.id)) return null;
  if (!validOutline(o.outline)) return null;
  if (!finite(o.seed) || o.seed < 0) return null;
  if (!within(o.x, LIMIT_X) || !within(o.z, LIMIT_Z) || !finite(o.heading)) return null;
  const mode = MODES.includes(o.mode as Mode) ? (o.mode as Mode) : 'free';
  let target: V2 | null = null;
  if (mode === 'goto') {
    const t = o.target;
    if (!Array.isArray(t) || !within(t[0], LIMIT_X) || !within(t[1], LIMIT_Z)) return null;
    target = [t[0], t[1]];
  }
  const seed = Math.floor(o.seed);
  const name = typeof o.name === 'string' ? cleanName(o.name) : '';
  return {
    id: o.id,
    outline: (o.outline as V2[]).map(([u, v]) => [u, v] as V2),
    seed,
    name: name || nameFor(seed),
    x: o.x, z: o.z, heading: Math.atan2(Math.sin(o.heading), Math.cos(o.heading)),
    mode, target,
  };
}

/** Validate untrusted JSON (storage or an imported file). Bad boats are dropped; a bad shape is rejected. */
export function parseDoc(raw: unknown): HarborDoc | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== DOC_VERSION || !Array.isArray(o.boats)) return null;
  const boats: BoatRecord[] = [];
  const ids = new Set<string>();
  for (const b of o.boats.slice(0, MAX_BOATS * 4)) {
    const boat = parseBoat(b);
    if (boat && !ids.has(boat.id)) {
      ids.add(boat.id);
      boats.push(boat);
    }
  }
  return { version: DOC_VERSION, boats: boats.slice(-MAX_BOATS) };
}

// --- built-in harbours ---------------------------------------------------------------------

/** Hull shapes for the built-in boats: width along the hull, stern (0) to bow (1). */
export const SHAPES = {
  tubby: (t: number) => 0.42 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.1 + t * 0.92)), 0.7),
  sleek: (t: number) => 0.2 * Math.sin(Math.PI * Math.pow(t, 0.75)) * (1 - 0.1 * t),
  classic: (t: number) => 0.3 * Math.sin(Math.PI * (0.12 + 0.88 * Math.pow(t, 0.8))),
  pram: (t: number) => 0.32 * Math.min(1, Math.sin(Math.PI * (0.18 + 0.7 * t)) * 1.25),
} as const;

function made(id: string, shape: keyof typeof SHAPES, length: number, seed: number, at: V2, heading: number, mode: Mode, target: V2 | null = null, name?: string): BoatRecord {
  const loop = parametricLoop(at[0], at[1], heading, length, SHAPES[shape]);
  const r = shapeFromLoop(loop);
  if (!r.ok) throw new Error(`built-in boat ${id} did not shape: ${r.reason}`);
  return { id, outline: r.hull.outline, seed, name: name ?? nameFor(seed), x: r.hull.center[0], z: r.hull.center[1], heading: r.hull.heading, mode, target };
}

const onMooring = (i: number, length: number): V2 => mooringSpot(i, length);
const HEAD_TO_WIND = Math.atan2(-0.55, 1);

/** First visit: a quiet harbour with two boats on their moorings. */
export function defaultDoc(): HarborDoc {
  return {
    version: DOC_VERSION,
    boats: [
      made('home-1', 'classic', 1.3, 6, onMooring(3, 1.3), HEAD_TO_WIND, 'free', null, 'Biscuit'),
      made('home-2', 'tubby', 1.0, 9, onMooring(1, 1.0), HEAD_TO_WIND, 'home', null, 'Little Bean'),
    ],
  };
}

/** Lots going on at once. */
export function showcaseDoc(): HarborDoc {
  const stamp = Date.now().toString(36);
  return {
    version: DOC_VERSION,
    boats: [
      made(`s1-${stamp}`, 'classic', 1.35, 6, [-3.2, 0.2], 0.4, 'out'),
      made(`s2-${stamp}`, 'sleek', 1.8, 21, [6.6, 5.4], 0.9, 'free'),
      made(`s3-${stamp}`, 'tubby', 0.95, 41, onMooring(0, 0.95), HEAD_TO_WIND, 'home'),
      made(`s4-${stamp}`, 'pram', 1.1, 35, [8.8, 2.4], -1.4, 'goto', [9.2, -0.6]),
      made(`s5-${stamp}`, 'classic', 1.15, 51, [-1, 5.4], Math.PI, 'free'),
      made(`s6-${stamp}`, 'sleek', 1.5, 18, onMooring(4, 1.5), HEAD_TO_WIND, 'free'),
    ],
  };
}

export { MOORINGS };
