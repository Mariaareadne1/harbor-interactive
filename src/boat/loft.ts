import { stations, type V2 } from './hull';

/**
 * Loft a deck outline into a little hull: rounded sections from the
 * gunwale down to a keel line, a sheer that lifts toward the bow, transoms
 * closing the ends, a painted rim along the top and a deck set just inside
 * it. Boat space: +x toward the bow, y up (water at 0), +z to starboard.
 * Plain typed arrays, so it runs in a worker.
 */

export const PART_HULL = 0, PART_RIM = 1, PART_DECK = 2, PART_TRANSOM = 3;

export interface LoftData {
  position: Float32Array;
  normal: Float32Array;
  /** part, u (-1 stern .. 1 bow), across (-1 port .. 1 starboard), height (0 keel .. 1 gunwale). */
  paint: Float32Array;
  index: Uint32Array;
  /** Gunwale height at the stern, middle and bow (for placing the mast, tiller and name). */
  freeboard: number;
  /** Keel depth at the middle. */
  draft: number;
}

const RING = 14; // points round each section
const RIM = 0.026;

export function freeboardOf(length: number): number {
  return 0.085 + 0.045 * length;
}

export function draftOf(length: number): number {
  return 0.07 + 0.04 * length;
}

/** Height of the gunwale at a fraction along the hull (-1 stern .. 1 bow): it sweeps up toward the bow. */
export function sheer(length: number, un: number): number {
  return freeboardOf(length) + 0.07 * Math.max(0, un) ** 2 * length * 0.5 + 0.03 * Math.max(0, -un) ** 2;
}

export function loftHull(outline: readonly V2[]): LoftData {
  const st = stations(outline, 30);
  const u0 = st[0].u, u1 = st[st.length - 1].u;
  const length = u1 - u0;
  const mid = (u0 + u1) / 2;
  const draft = draftOf(length);
  const pos: number[] = [];
  const paint: number[] = [];
  const idx: number[] = [];
  const un = (u: number) => (2 * (u - mid)) / length;
  const push = (x: number, y: number, z: number, part: number, u: number, across: number, h: number) => {
    pos.push(x, y, z);
    paint.push(part, u, across, h);
    return pos.length / 3 - 1;
  };
  const grid = (rows: number[][], flip = false) => {
    for (let i = 0; i < rows.length - 1; i++) {
      for (let k = 0; k < rows[i].length - 1; k++) {
        const a = rows[i][k], b = rows[i + 1][k], c = rows[i][k + 1], d = rows[i + 1][k + 1];
        if (flip) idx.push(a, c, b, c, d, b);
        else idx.push(a, b, c, c, b, d);
      }
    }
  };

  // ---- the outer skin: one ring per station, from the starboard gunwale under the keel to port ----
  const skin: number[][] = [];
  for (const s of st) {
    const n = un(s.u);
    const top = sheer(length, n);
    const depth = draft * Math.sqrt(Math.max(0.02, 1 - n ** 4)) * (0.6 + 0.4 * Math.min(1, (s.port + s.starboard) / (length * 0.3)));
    const ring: number[] = [];
    for (let k = 0; k <= RING; k++) {
      const th = -Math.PI / 2 + (k / RING) * Math.PI; // -90° starboard gunwale .. +90° port gunwale
      const w = th < 0 ? s.starboard : s.port;
      const side = Math.sin(th);
      // a full, round bilge: wide low down, then up the topsides
      const z = -Math.sign(side) * w * Math.pow(Math.abs(side), 0.55);
      const y = top - (top + depth) * Math.pow(Math.cos(th), 1.5);
      ring.push(push(s.u, y, z, PART_HULL, n, z / Math.max(1e-3, w), (y + depth) / (top + depth)));
    }
    skin.push(ring);
  }
  grid(skin);

  // ---- the rim: a flat painted band along the top of the gunwale, and the inner lip down to the deck ----
  const rimRows: number[][] = [];
  for (const s of st) {
    const n = un(s.u);
    const top = sheer(length, n);
    const deckY = top - 0.03;
    const sw = s.starboard, pw = s.port;
    const inS = Math.max(0, sw - RIM), inP = Math.max(0, pw - RIM);
    rimRows.push([
      push(s.u, top, sw, PART_RIM, n, 1, 1),
      push(s.u, top, inS, PART_RIM, n, 1, 1),
      push(s.u, deckY, inS, PART_RIM, n, 1, 0.9),
    ]);
    rimRows.push([
      push(s.u, deckY, -inP, PART_RIM, n, -1, 0.9),
      push(s.u, top, -inP, PART_RIM, n, -1, 1),
      push(s.u, top, -pw, PART_RIM, n, -1, 1),
    ]);
  }
  const star = rimRows.filter((_, i) => i % 2 === 0), port = rimRows.filter((_, i) => i % 2 === 1);
  grid(star, true);
  grid(port, true);

  // ---- the deck: a strip between the inner lips ----
  const deck: number[][] = [];
  for (const s of st) {
    const n = un(s.u);
    const deckY = sheer(length, n) - 0.03;
    const inS = Math.max(0, s.starboard - RIM), inP = Math.max(0, s.port - RIM);
    const row: number[] = [];
    for (let k = 0; k <= 4; k++) {
      const z = inS + (-inP - inS) * (k / 4);
      row.push(push(s.u, deckY, z, PART_DECK, n, z / Math.max(1e-3, Math.max(inS, inP)), 1));
    }
    deck.push(row);
  }
  grid(deck, true);

  // ---- transoms: close each end where the drawing left it wide ----
  for (const [end, dir] of [[0, -1], [st.length - 1, 1]] as const) {
    const ring = skin[end];
    const s = st[end];
    const n = un(s.u);
    const c = push(s.u, sheer(length, n) - 0.03, 0, PART_TRANSOM, n, 0, 0.8);
    const verts = ring.map((i) => push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], PART_TRANSOM, n, paint[i * 4 + 2], paint[i * 4 + 3]));
    for (let k = 0; k < verts.length - 1; k++) {
      if (dir < 0) idx.push(c, verts[k + 1], verts[k]);
      else idx.push(c, verts[k], verts[k + 1]);
    }
  }

  const position = new Float32Array(pos);
  const index = new Uint32Array(idx);
  return { position, normal: vertexNormals(position, index), paint: new Float32Array(paint), index, freeboard: freeboardOf(length), draft };
}

function vertexNormals(p: Float32Array, index: Uint32Array): Float32Array {
  const n = new Float32Array(p.length);
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    const abx = p[b] - p[a], aby = p[b + 1] - p[a + 1], abz = p[b + 2] - p[a + 2];
    const acx = p[c] - p[a], acy = p[c + 1] - p[a + 1], acz = p[c + 2] - p[a + 2];
    const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
    for (const v of [a, b, c]) {
      n[v] += nx;
      n[v + 1] += ny;
      n[v + 2] += nz;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l;
    n[i + 1] /= l;
    n[i + 2] /= l;
  }
  return n;
}
