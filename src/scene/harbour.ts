import { noise2, seededRandom } from './noise';

/**
 * The harbour is a painted tile — 24 × 17 world units — seen from above at
 * a three-quarter angle. y is up, the water lies at y = 0, the camera sits
 * on the +z side looking toward -z. The town climbs a hillside along the
 * back behind a curved stone quay; a lighthouse stands on a rocky point to
 * the right; a breakwater runs across the front-left, and the gap between
 * its tip and the point opens onto the sea, which fills the front and the
 * right of the tile and fades into the paper.
 *
 * Everything that needs the shape of the place (the land mesh, the painted
 * water, the boats' steering, dragging, tests) calls these functions, so
 * nothing can disagree.
 */

export const TILE = { halfX: 12, halfZ: 8.5 };
/** Boat metres per world unit (for labels): boats are drawn larger than life. */
export const BOAT_METRES = 2.2;
export const QUAY_Y = 0.24;

export type V2 = readonly [number, number];

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const smoothstep = (a: number, b: number, t: number) => {
  const x = clamp((t - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};

/** Catmull–Rom densify a polyline so a painted coast curves instead of kinking. */
export function densify(pts: readonly V2[], per = 5): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function segDist(px: number, pz: number, a: V2, b: V2): number {
  const bx = b[0] - a[0], bz = b[1] - a[1];
  const t = clamp(((px - a[0]) * bx + (pz - a[1]) * bz) / (bx * bx + bz * bz || 1), 0, 1);
  return Math.hypot(px - a[0] - bx * t, pz - a[1] - bz * t);
}

export function polylineDistance(pts: readonly V2[], x: number, z: number): number {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, segDist(x, z, pts[i], pts[i + 1]));
  return d;
}

// --- the quay -------------------------------------------------------------------

export const QUAY = { x0: -8.1, x1: 4.6, width: 1.05 };

/** z of the quay's water edge at x: a gentle arc, bowed back in the middle. */
export function quayZ(x: number): number {
  const cx = clamp(x, QUAY.x0, QUAY.x1);
  return -3.92 + 0.0185 * (cx + 1.8) ** 2;
}
export function quayTangent(x: number): number {
  return 2 * 0.0185 * (clamp(x, QUAY.x0, QUAY.x1) + 1.8);
}

const QUAY_PTS: V2[] = [];
for (let x = QUAY.x0; x <= QUAY.x1 + 1e-6; x += (QUAY.x1 - QUAY.x0) / 40) QUAY_PTS.push([x, quayZ(x)]);
export const QUAY_LINE: readonly V2[] = QUAY_PTS;

// --- the coast --------------------------------------------------------------------

/** The coastline from the left edge to the right edge; land lies behind it (toward -z). */
const BEACH: V2[] = [[-13.6, 2.25], [-11.35, 2.3], [-10.6, 1.35], [-9.8, -0.5], [-9.0, -2.15], [-8.3, -2.95]];
const HEADLAND: V2[] = [[4.95, -2.9], [5.45, -2.05], [5.75, -1.05], [6.0, -0.2], [6.55, 0.28], [7.2, -0.05], [7.55, -1.15], [8.1, -2.45], [9.4, -3.25], [11.0, -3.55], [13.6, -3.75]];

export const COAST: readonly V2[] = [...densify(BEACH, 4), ...QUAY_PTS.slice(1, -1), ...densify(HEADLAND, 4)];
/** The land as a closed polygon. */
const LAND: readonly V2[] = [...COAST, [13.6, -10.5], [-13.6, -10.5]];

/** The breakwater's centreline, from the rocks at the front-left to its tip with the beacon. */
export const BREAKWATER: readonly V2[] = densify([[-11.6, 2.55], [-8.0, 3.2], [-4.0, 3.45], [-0.6, 3.32], [1.8, 2.92]], 4);
export const BREAKWATER_HALF = 0.32;
export const BREAKWATER_Y = 0.3;
export const BREAKWATER_TIP: V2 = [1.8, 2.92];
/** The rocky point the lighthouse stands on, and the lighthouse itself. */
export const POINT_TIP: V2 = [6.45, 0.18];
export const LIGHTHOUSE = { x: 6.6, z: -0.55, radius: 0.3, height: 2.05 };

/** Where boats go through the gap between the breakwater and the point. */
const MOUTH_C: V2 = [(BREAKWATER_TIP[0] + POINT_TIP[0]) / 2, (BREAKWATER_TIP[1] + POINT_TIP[1]) / 2];
const MOUTH_N: V2 = (() => {
  const dx = POINT_TIP[0] - BREAKWATER_TIP[0], dz = POINT_TIP[1] - BREAKWATER_TIP[1];
  const l = Math.hypot(dx, dz);
  return [-dz / l, dx / l] as V2; // points out to sea
})();
export const GAP_IN: V2 = [MOUTH_C[0] - MOUTH_N[0] * 1.5, MOUTH_C[1] - MOUTH_N[1] * 1.5];
export const GAP_OUT: V2 = [MOUTH_C[0] + MOUTH_N[0] * 1.7, MOUTH_C[1] + MOUTH_N[1] * 1.7];
export const MOUTH = { c: MOUTH_C, n: MOUTH_N };

function pointInPolygon(poly: readonly V2[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Signed distance to the coast: negative on land, positive over water. */
export function coastDistance(x: number, z: number): number {
  const d = polylineDistance(COAST, x, z);
  return pointInPolygon(LAND, x, z) ? -d : d;
}

/** Distance to the breakwater's edge (negative on it). */
export function breakwaterDistance(x: number, z: number): number {
  return polylineDistance(BREAKWATER, x, z) - BREAKWATER_HALF;
}

/** Rocks standing in the water round the point and at the breakwater's root. */
export interface Rock { readonly x: number; readonly z: number; readonly r: number; readonly seed: number }
export const ROCKS: readonly Rock[] = [
  { x: 6.2, z: 0.45, r: 0.34, seed: 1 },
  { x: 6.85, z: 0.42, r: 0.28, seed: 2 },
  { x: 7.35, z: -0.35, r: 0.3, seed: 3 },
  { x: 5.75, z: -0.15, r: 0.22, seed: 4 },
  { x: 7.7, z: -1.6, r: 0.24, seed: 5 },
  { x: -11.7, z: 2.45, r: 0.36, seed: 6 },
  { x: -11.0, z: 2.75, r: 0.26, seed: 7 },
  { x: 2.05, z: 2.72, r: 0.2, seed: 8 },
];

/** Exact distance (m) to anything solid: land, the quay, the breakwater, rocks. */
export function obstacleDistanceExact(x: number, z: number): number {
  let d = Math.min(coastDistance(x, z), breakwaterDistance(x, z));
  for (const r of ROCKS) d = Math.min(d, Math.hypot(x - r.x, z - r.z) - r.r * 0.9);
  return d;
}

// the same field sampled once on a fine grid: steering asks for it thousands of times a second
const GRID = { step: 0.05, x0: -TILE.halfX - 3, z0: -TILE.halfZ - 3, nx: 0, nz: 0 };
GRID.nx = Math.ceil((2 * TILE.halfX + 6) / GRID.step) + 1;
GRID.nz = Math.ceil((2 * TILE.halfZ + 6) / GRID.step) + 1;
let field: Float32Array | null = null;

function obstacleField(): Float32Array {
  if (field) return field;
  const f = new Float32Array(GRID.nx * GRID.nz);
  for (let j = 0; j < GRID.nz; j++) {
    for (let i = 0; i < GRID.nx; i++) f[j * GRID.nx + i] = obstacleDistanceExact(GRID.x0 + i * GRID.step, GRID.z0 + j * GRID.step);
  }
  return (field = f);
}

/** How far (m) a point is from anything solid (negative inside it). Bilinear on the precomputed grid. */
export function obstacleDistance(x: number, z: number): number {
  const fx = (x - GRID.x0) / GRID.step, fz = (z - GRID.z0) / GRID.step;
  const i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= GRID.nx - 1 || j >= GRID.nz - 1) return obstacleDistanceExact(x, z);
  const f = obstacleField();
  const tx = fx - i, tz = fz - j;
  const k = j * GRID.nx + i;
  const a = f[k] + (f[k + 1] - f[k]) * tx;
  const b = f[k + GRID.nx] + (f[k + GRID.nx + 1] - f[k + GRID.nx]) * tx;
  return a + (b - a) * tz;
}

export function obstacleGradient(x: number, z: number, eps = 0.05): [number, number] {
  const gx = obstacleDistance(x + eps, z) - obstacleDistance(x - eps, z);
  const gz = obstacleDistance(x, z + eps) - obstacleDistance(x, z - eps);
  const l = Math.hypot(gx, gz) || 1;
  return [gx / l, gz / l];
}

export function isWater(x: number, z: number): boolean {
  return coastDistance(x, z) > 0 && breakwaterDistance(x, z) > 0 && edgeDistance(x, z) > 0;
}

/** Distance inside the tile's edge (m); negative outside. */
export function edgeDistance(x: number, z: number): number {
  return Math.min(TILE.halfX - Math.abs(x), TILE.halfZ - Math.abs(z));
}

/** z of the breakwater-and-mouth line at x: inside the harbour is behind it. */
function harbourLineZ(x: number): number {
  if (x <= BREAKWATER[0][0]) return BREAKWATER[0][1];
  for (let i = 1; i < BREAKWATER.length; i++) {
    const a = BREAKWATER[i - 1], b = BREAKWATER[i];
    if (x <= b[0]) return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0] || 1);
  }
  const t = clamp((x - BREAKWATER_TIP[0]) / (POINT_TIP[0] - BREAKWATER_TIP[0]), 0, 1);
  return BREAKWATER_TIP[1] + (POINT_TIP[1] - BREAKWATER_TIP[1]) * t;
}

/** Inside the harbour (water behind the breakwater and the mouth), rather than out at sea. */
export function inHarbour(x: number, z: number): boolean {
  return x < POINT_TIP[0] + 0.3 && z < harbourLineZ(x);
}

/** 1 deep in the calm harbour, 0 out at sea, soft across the mouth. */
export function calmness(x: number, z: number): number {
  if (x > POINT_TIP[0] + 1.5) return 0;
  const over = z - harbourLineZ(x);
  return 1 - smoothstep(-0.8, 1.2, over) * (x > -12 ? 1 : 0);
}

// --- heights ----------------------------------------------------------------------

/** How far back from the quay's edge (for the terraces of the town). */
export function behindQuay(x: number, z: number): number {
  return quayZ(x) - z;
}

/** The terraces' ground height behind the quay: the quay road, then three steps up the hill. */
export function terraceHeight(s: number): number {
  return QUAY_Y + 0.5 * (smoothstep(1.98, 2.32, s) + smoothstep(3.2, 3.54, s) + smoothstep(4.42, 4.76, s));
}

/** Ground height of the land at (x, z) (the seabed below the water). */
export function landHeight(x: number, z: number): number {
  const c = coastDistance(x, z);
  const onQuay = x > QUAY.x0 - 0.15 && x < QUAY.x1 + 0.15 && z < quayZ(x) + 0.3;
  if (c > 0) {
    // the seabed: a shallow sandy shelf off the beach, deeper off the quay and the rocks
    const beach = x < QUAY.x0 && z > -3.2 ? 1 : 0;
    const slope = beach ? 0.14 : 0.45;
    return -0.06 - Math.min(1.1, c * slope) - (onQuay ? 0.3 : 0);
  }
  const inland = -c;
  const roll = 0.03 * noise2(x / 2.2 + 3.1, z / 2.2 - 1.7);
  if (onQuay) return terraceHeight(behindQuay(x, z)) + (behindQuay(x, z) > 1.9 ? roll : 0);
  // the hill rises behind the beach and up toward the chapel at the back-left
  const hill = 0.55 * smoothstep(-2.5, -6.5, z) * smoothstep(-6.5, -9.5, x) + 0.35 * smoothstep(-3.8, -7.5, z);
  if (x < QUAY.x0) {
    // sand rises gently from the water, then grass
    return Math.min(0.2, inland * 0.17) + hill * smoothstep(0.6, 2.4, inland) + roll * smoothstep(0.5, 1.5, inland);
  }
  if (x > QUAY.x1) {
    // the headland: rocky and grassy, a low hump out to the point
    const hump = 0.42 * smoothstep(0.0, 0.9, inland) + 0.18 * smoothstep(-1.5, -5.5, z);
    return 0.05 + hump + roll * 2;
  }
  return terraceHeight(behindQuay(x, z)) + roll;
}

export type SurfaceKind = 'water' | 'quay' | 'beach' | 'grass' | 'rock' | 'breakwater' | 'paper';

export function surfaceKind(x: number, z: number): SurfaceKind {
  if (edgeDistance(x, z) < 0) return 'paper';
  if (breakwaterDistance(x, z) < 0) return 'breakwater';
  const c = coastDistance(x, z);
  if (c > 0) return 'water';
  if (x > QUAY.x0 && x < QUAY.x1 && behindQuay(x, z) < QUAY.width) return 'quay';
  if (x < QUAY.x0 && -c < 1.5 && z > -4) return 'beach';
  if (x > QUAY.x1 && -c < 0.6) return 'rock';
  return 'grass';
}

// --- the town -----------------------------------------------------------------------

export interface House {
  readonly x: number;
  readonly z: number;
  /** Ground height under it. */
  readonly y: number;
  /** Yaw (rotation.y); the ridge runs along local u, the front faces +v (the water). */
  readonly rot: number;
  readonly w: number;
  readonly d: number;
  readonly wallH: number;
  readonly roofH: number;
  readonly wall: string;
  readonly roof: string;
  readonly shutters: string;
  /** Has a café awning on the ground floor. */
  readonly cafe: boolean;
}

export const ROOF_OVERHANG = 0.08;
const PASTELS = ['#f2c3bb', '#c4e2cd', '#f5e2a0', '#bcd6ec', '#f6cfa8', '#f3ead8', '#dccbe9', '#f0b9a6', '#cfe6e0'];
const ROOFS = ['#cf6f4f', '#c45f43', '#d98a5f', '#cc7452'];
const SHUTTERS = ['#5f8f7a', '#4e7395', '#8a6b52', '#6f8f5a', '#b65b4b'];

const ROWS = [
  { s: 1.5, x0: -7.2, x1: 3.9, wall: [1.05, 1.32], gap: [0.04, 0.3] },
  { s: 2.76, x0: -6.0, x1: 2.6, wall: [0.92, 1.18], gap: [0.1, 0.7] },
  { s: 4.0, x0: -4.4, x1: 1.2, wall: [0.82, 1.02], gap: [0.25, 1.1] },
];

function layoutTown(): House[] {
  const rand = seededRandom(1893);
  const houses: House[] = [];
  let pastel = 0;
  ROWS.forEach((row, ri) => {
    let x = row.x0;
    while (true) {
      const w = 0.82 + rand() * 0.36;
      const cx = x + w / 2;
      if (cx + w / 2 > row.x1) break;
      const z = quayZ(cx) - row.s;
      const rot = -Math.atan(quayTangent(cx));
      const wallH = row.wall[0] + rand() * (row.wall[1] - row.wall[0]);
      // the café sits on the quay a little left of the middle
      const cafe = ri === 0 && houses.length === 3;
      houses.push({
        x: cx, z, y: terraceHeight(row.s), rot, w, d: 0.78 + rand() * 0.12,
        wallH, roofH: 0.26 + rand() * 0.08,
        wall: PASTELS[(pastel++ * 4 + ri) % PASTELS.length],
        roof: ROOFS[Math.floor(rand() * ROOFS.length)],
        shutters: SHUTTERS[Math.floor(rand() * SHUTTERS.length)],
        cafe,
      });
      x += w + row.gap[0] + rand() * (row.gap[1] - row.gap[0]);
      // a gap for a stair lane up the hill
      if (ri > 0 && Math.abs(x - -1.3) < 0.5) x += 0.6;
    }
  });
  return houses;
}

export const HOUSES: readonly House[] = layoutTown();

/** The little chapel up on the hill at the back-left, with its bell tower. */
export const CHAPEL = { x: -9.6, z: -6.1, rot: 0.18, w: 1.45, d: 0.86, wallH: 0.82, roofH: 0.4, tower: { du: -0.95, half: 0.24, height: 1.62 } };

export interface Tree { readonly x: number; readonly z: number; readonly r: number; readonly color: string; readonly seed: number; readonly tall: boolean }

const TREE_SPOTS: Tree[] = [
  { x: -11.0, z: -4.4, r: 0.55, color: '#78b653', seed: 1, tall: false },
  { x: -8.3, z: -7.4, r: 0.32, color: '#5f9a4c', seed: 2, tall: true },
  { x: -7.6, z: -7.6, r: 0.3, color: '#5a944a', seed: 3, tall: true },
  { x: -11.2, z: -7.6, r: 0.6, color: '#84bd59', seed: 4, tall: false },
  { x: 2.6, z: -7.7, r: 0.5, color: '#7cb956', seed: 5, tall: false },
  { x: 4.3, z: -6.6, r: 0.55, color: '#72b04f', seed: 6, tall: false },
  { x: 6.6, z: -4.6, r: 0.5, color: '#88c25d', seed: 7, tall: false },
  { x: 9.6, z: -6.6, r: 0.62, color: '#78b653', seed: 8, tall: false },
  { x: 11.0, z: -5.0, r: 0.45, color: '#e8a7b7', seed: 9, tall: false },
  { x: 3.4, z: -5.4, r: 0.3, color: '#5f9a4c', seed: 10, tall: true },
  { x: -5.6, z: -8.0, r: 0.28, color: '#5a944a', seed: 11, tall: true },
  { x: 7.9, z: -6.9, r: 0.3, color: '#5f9a4c', seed: 12, tall: true },
];

export const TREES: readonly Tree[] = TREE_SPOTS.filter(
  (t) => !HOUSES.some((h) => Math.hypot(h.x - t.x, h.z - t.z) < Math.hypot(h.w, h.d) / 2 + t.r) && coastDistance(t.x, t.z) < -0.6,
);

// --- moorings and the sea -----------------------------------------------------------------

/** Mooring buoys inside the harbour. */
export const MOORINGS: readonly V2[] = [
  [-6.9, -1.3], [-5.0, 0.9], [-3.4, -1.75], [-1.3, 0.4], [0.7, -1.9], [-7.6, 1.05], [0.9, 1.25], [2.75, -1.45],
];

/** The open sea: where a boat's loop goes. Kept clear of the paper edge. */
export const SEA = {
  /** The front strip, in front of the breakwater. */
  front: { x0: -8.5, x1: 9.5, z0: 4.5, z1: 6.9 },
  /** The right strip, beyond the point. */
  right: { x0: 8.4, x1: 10.2, z0: -2.0, z1: 6.6 },
};

/** Boats are kept this far inside the tile's edge (except when sailing off). */
export const SEA_MARGIN = 1.35;

// --- the breeze ----------------------------------------------------------------------------

/** Where the wind comes from: off the sea at the back-right (unit, xz). */
export const WIND_FROM: V2 = (() => {
  const x = 1, z = -0.55, l = Math.hypot(x, z);
  return [x / l, z / l] as V2;
})();
/** Which way it blows. */
export const WIND_TO: V2 = [-WIND_FROM[0], -WIND_FROM[1]];

/** Wind strength (0.7 .. 1.3): a constant breeze that slowly freshens and eases. Pure function of time. */
export function windStrength(t: number): number {
  return 1 + 0.16 * Math.sin(t * 0.21) + 0.09 * Math.sin(t * 0.53 + 1.3) + 0.05 * Math.sin(t * 1.37 + 0.4);
}

/** A gentle swell for bobbing: height (m) and slopes at a point. Calmer in the harbour. */
export function swellAt(x: number, z: number, t: number, calm = calmness(x, z)): { h: number; dx: number; dz: number } {
  const amp = 0.012 + 0.028 * (1 - calm);
  const waves: [number, number, number, number][] = [
    // direction along the wind (x, z), wavenumber, speed
    [WIND_TO[0], WIND_TO[1], 2.1, 1.3],
    [0.5, 0.86, 3.3, 1.7],
    [-0.9, 0.42, 4.6, 2.1],
  ];
  let h = 0, dx = 0, dz = 0;
  waves.forEach(([wx, wz, k, s], i) => {
    const a = amp / (i + 1);
    const ph = (x * wx + z * wz) * k - t * s + i * 1.7;
    h += a * Math.sin(ph);
    dx += a * k * wx * Math.cos(ph);
    dz += a * k * wz * Math.cos(ph);
  });
  return { h, dx, dz };
}
