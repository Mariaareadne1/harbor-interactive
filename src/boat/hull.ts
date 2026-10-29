/**
 * Stroke → hull outline. Pure and deterministic, so it is unit tested and
 * can run anywhere (the main thread to place the boat, a worker to loft it).
 *
 * The drawn loop is closed, resampled evenly, turned so its long axis runs
 * bow to stern with the bow at its narrower, more pointed end, then made
 * mostly — not perfectly — symmetric about that axis, and clamped to a
 * sensible size. The result is a deck outline in the boat's own frame:
 * +u toward the bow, v across (positive to starboard), centred on the hull.
 */

export type V2 = readonly [number, number];

export const MAX_OUTLINE = 48;
/** Half-stations per side in the outline (the outline has 2 × STATIONS points). */
export const STATIONS = 24;
export const LENGTH_RANGE: readonly [number, number] = [0.75, 1.9];
/** Beam / length: from sleek to tubby, but always a boat. */
export const BEAM_RATIO: readonly [number, number] = [0.24, 0.64];
/** How far a hull is pulled toward perfect symmetry (1 = mirror image). */
export const SYMMETRY = 0.72;

export interface HullShape {
  /** Deck outline in boat space, starboard side stern→bow then port side bow→stern. */
  outline: V2[];
  length: number;
  beam: number;
}

export interface PlacedHull extends HullShape {
  /** World centre of the hull (x, z). */
  center: V2;
  /** Heading: the bow points along (cos, sin) in world (x, z). */
  heading: number;
}

export type HullError = 'open' | 'small' | 'thin';
export type HullResult = { ok: true; hull: PlacedHull } | { ok: false; reason: HullError };

export function perimeter(pts: readonly V2[], closed = true): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (closed && pts.length > 1) len += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
  return len;
}

/** Signed area (positive counter-clockwise in x, z). */
export function polygonArea(pts: readonly V2[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a / 2;
}

/**
 * Is this stroke a closed loop? The gap between its ends must be small
 * compared with the whole line and with the shape's size. Loops drawn past
 * their start (overlapping) are trimmed back to where they cross.
 */
export function closeLoop(pts: readonly V2[]): V2[] | null {
  if (pts.length < 8) return null;
  const total = perimeter(pts, false);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const size = Math.max(maxX - minX, maxZ - minZ);
  // an overshoot: the end comes back near an early point — cut it there
  const first = pts[0];
  let best = Math.hypot(pts[pts.length - 1][0] - first[0], pts[pts.length - 1][1] - first[1]);
  let cut = pts.length;
  let walked = 0;
  for (let i = pts.length - 1; i > pts.length * 0.6; i--) {
    walked += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (walked > total * 0.3) break;
    const d = Math.hypot(pts[i][0] - first[0], pts[i][1] - first[1]);
    if (d < best) {
      best = d;
      cut = i + 1;
    }
  }
  if (best > total * 0.2 || best > size * 0.45) return null;
  return pts.slice(0, cut);
}

/** Resample a closed polygon to n points evenly spaced along its perimeter. */
export function resampleClosed(pts: readonly V2[], n: number): V2[] {
  const ring = [...pts, pts[0]];
  const cum = [0];
  for (let i = 1; i < ring.length; i++) cum.push(cum[i - 1] + Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]));
  const total = cum[cum.length - 1];
  const out: V2[] = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const s = (k / n) * total;
    while (j < cum.length - 1 && cum[j] < s) j++;
    const t = (s - cum[j - 1]) / (cum[j] - cum[j - 1] || 1);
    out.push([ring[j - 1][0] + (ring[j][0] - ring[j - 1][0]) * t, ring[j - 1][1] + (ring[j][1] - ring[j - 1][1]) * t]);
  }
  return out;
}

/** Principal axis of a point set (unit vector) and its centroid. */
export function principalAxis(pts: readonly V2[]): { c: V2; axis: V2 } {
  let cx = 0, cz = 0;
  for (const [x, z] of pts) { cx += x; cz += z; }
  cx /= pts.length; cz /= pts.length;
  let sxx = 0, sxz = 0, szz = 0;
  for (const [x, z] of pts) {
    const dx = x - cx, dz = z - cz;
    sxx += dx * dx; sxz += dx * dz; szz += dz * dz;
  }
  const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  return { c: [cx, cz], axis: [Math.cos(angle), Math.sin(angle)] };
}

/** The outer extent of a polygon across a line u = const: [min v, max v], or null if it misses. */
function sliceAt(poly: readonly V2[], u: number): [number, number] | null {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ua, va] = poly[j], [ub, vb] = poly[i];
    if ((ua <= u && ub >= u) || (ub <= u && ua >= u)) {
      const t = ub === ua ? 0.5 : (u - ua) / (ub - ua);
      const v = va + (vb - va) * t;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  return lo <= hi ? [lo, hi] : null;
}

/** Stations along the hull, closer together toward the ends, where the shape changes fastest. */
export function stationU(i: number, n: number, u0: number, u1: number): number {
  const t = i / (n - 1);
  const k = 0.5 - 0.5 * Math.cos(t * Math.PI);
  // a hair inside the very ends, where the slice would collapse to a point
  return u0 + (u1 - u0) * (0.004 + 0.992 * (0.35 * t + 0.65 * k));
}

export interface Station { u: number; port: number; starboard: number }

/** Half-widths along a hull outline (boat space). */
export function stations(outline: readonly V2[], n = STATIONS): Station[] {
  let u0 = Infinity, u1 = -Infinity;
  for (const [u] of outline) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); }
  const out: Station[] = [];
  for (let i = 0; i < n; i++) {
    const u = stationU(i, n, u0, u1);
    const s = sliceAt(outline, u) ?? [0, 0];
    out.push({ u, starboard: Math.max(0, s[1]), port: Math.max(0, -s[0]) });
  }
  return out;
}

function outlineFrom(st: readonly Station[]): V2[] {
  const out: V2[] = [];
  for (const s of st) out.push([s.u, s.starboard]);
  for (let i = st.length - 1; i >= 0; i--) out.push([st[i].u, -st[i].port]);
  return out.map(([u, v]) => [Math.round(u * 1e4) / 1e4, Math.round(v * 1e4) / 1e4] as V2);
}

const mean = (a: readonly number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);

/** Which end is the bow: +1 if the +u end is narrower (more pointed) than the -u end. */
export function bowSign(st: readonly Station[]): 1 | -1 {
  const n = st.length;
  const k = Math.max(2, Math.round(n * 0.22));
  const width = (s: Station) => s.port + s.starboard;
  const tail = mean(st.slice(0, k).map(width));
  const head = mean(st.slice(n - k).map(width));
  return head <= tail * 1.02 ? 1 : -1;
}

/** Turn a closed loop drawn on the water (world x, z) into a placed hull. */
export function shapeFromLoop(loop: readonly V2[]): HullResult {
  const closed = closeLoop(loop);
  if (!closed) return { ok: false, reason: 'open' };
  if (perimeter(closed) < 1.0 || Math.abs(polygonArea(closed)) < 0.06) return { ok: false, reason: 'small' };
  const ring = resampleClosed(closed, 96);
  const { c, axis } = principalAxis(ring);
  // into the drawing's own frame: u along the long axis, v across
  const side: V2 = [-axis[1], axis[0]];
  let local: V2[] = ring.map(([x, z]) => [(x - c[0]) * axis[0] + (z - c[1]) * axis[1], (x - c[0]) * side[0] + (z - c[1]) * side[1]]);
  let st = stations(local);
  const bow = bowSign(st);
  if (bow < 0) {
    // flip so the bow is at +u (a half turn keeps the drawing's handedness)
    local = local.map(([u, v]) => [-u, -v]);
    st = stations(local);
  }
  let u0 = Infinity, u1 = -Infinity;
  for (const [u] of local) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); }
  const rawLength = u1 - u0;
  const rawBeam = Math.max(...st.map((s) => s.port + s.starboard));
  if (rawBeam < rawLength * 0.06) return { ok: false, reason: 'thin' };

  // mostly symmetric, keeping a little of the drawing's lopsidedness
  const sym = st.map((s) => {
    const half = (s.port + s.starboard) / 2;
    return { u: s.u, port: s.port + (half - s.port) * SYMMETRY, starboard: s.starboard + (half - s.starboard) * SYMMETRY };
  });
  // clamp the size, then the proportions
  const length = Math.min(LENGTH_RANGE[1], Math.max(LENGTH_RANGE[0], rawLength));
  const k = length / rawLength;
  const ratio = rawBeam / rawLength;
  const wk = ratio < BEAM_RATIO[0] ? BEAM_RATIO[0] / ratio : ratio > BEAM_RATIO[1] ? BEAM_RATIO[1] / ratio : 1;
  const mid = (u0 + u1) / 2;
  const scaled = sym.map((s) => ({ u: (s.u - mid) * k, port: s.port * k * wk, starboard: s.starboard * k * wk }));
  const outline = outlineFrom(scaled);
  const beam = Math.max(...scaled.map((s) => s.port + s.starboard));
  // the boat sits where it was drawn: the middle of its length, on the drawing's axis
  const fwd: V2 = bow > 0 ? axis : [-axis[0], -axis[1]];
  const center: V2 = [c[0] + fwd[0] * mid, c[1] + fwd[1] * mid];
  return { ok: true, hull: { outline, length, beam, center, heading: Math.atan2(fwd[1], fwd[0]) } };
}

/** Rebuild the measurements of a saved outline (boat space). */
export function shapeFromOutline(outline: readonly V2[]): HullShape {
  const st = stations(outline);
  let u0 = Infinity, u1 = -Infinity;
  for (const [u] of outline) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); }
  return { outline: outline.map((p) => [p[0], p[1]] as V2), length: u1 - u0, beam: Math.max(...st.map((s) => s.port + s.starboard)) };
}

/** Is a saved outline a plausible hull? (validation of untrusted data) */
export function validOutline(raw: unknown): raw is V2[] {
  if (!Array.isArray(raw) || raw.length < 8 || raw.length > MAX_OUTLINE) return false;
  for (const p of raw) {
    if (!Array.isArray(p) || p.length !== 2 || !p.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 2)) return false;
  }
  const s = shapeFromOutline(raw as V2[]);
  return s.length >= LENGTH_RANGE[0] * 0.95 && s.length <= LENGTH_RANGE[1] * 1.05 && s.beam > 0.05 && s.beam < s.length;
}

/** A hull from a parametric deck shape (for built-in boats and tests): width(t) for t in 0 (stern) .. 1 (bow). */
export function parametricLoop(cx: number, cz: number, heading: number, length: number, width: (t: number) => number, n = 64): V2[] {
  const fx = Math.cos(heading), fz = Math.sin(heading);
  const pts: V2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const t = 0.5 + 0.5 * Math.cos(a);
    const u = (t - 0.5) * length;
    const v = Math.sin(a) * width(t);
    pts.push([cx + fx * u - fz * v, cz + fz * u + fx * v]);
  }
  return pts;
}
