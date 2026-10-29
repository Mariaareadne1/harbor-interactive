import {
  GAP_IN, GAP_OUT, MOORINGS, SEA_MARGIN, TILE, WIND_FROM, WIND_TO, edgeDistance, inHarbour, obstacleDistance, obstacleGradient, windStrength, type V2,
} from '../scene/harbour';
import { seededRandom } from '../scene/noise';

/**
 * The harbour's sailing, as a small deterministic simulation stepped at a
 * fixed rate. Every boat sails on one breeze by a simple points-of-sail
 * model: fastest on a beam reach, slower close-hauled and running, and
 * unable to sail into the wind — so a boat sent upwind beats there in
 * zig-zags, tacking through the wind with its boom swinging across. Boats
 * route through the gap in the breakwater, loop out at sea, come home and
 * pick up a free mooring head-to-wind, keep clear of each other and of
 * anything solid, and bump gently when they don't.
 *
 * Nothing here knows about rendering; given the same steps it always does
 * the same thing, so tests and recordings are reproducible.
 */

export const STEP = 1 / 60;
/** Inside this angle off the wind a sail cannot drive the boat. */
export const NO_GO = (44 * Math.PI) / 180;
/** The course a boat beats on, either side of the wind. */
export const CLOSE_HAULED = (50 * Math.PI) / 180;
const MIN_TACK_GAP = 2.2;
const WIND_ANGLE = Math.atan2(WIND_FROM[1], WIND_FROM[0]);

export type Intent = { kind: 'free' } | { kind: 'out' } | { kind: 'home' } | { kind: 'goto'; x: number; z: number };
export type Phase = 'launch' | 'sailing' | 'shooting' | 'moored' | 'waiting' | 'leaving' | 'gone';
type Purpose = 'out' | 'home' | 'goto' | 'loiter' | 'leave';

export interface SimBoat {
  readonly id: string;
  readonly length: number;
  readonly beam: number;
  x: number;
  z: number;
  heading: number;
  speed: number;
  /** Rate of turn (rad/s). */
  turn: number;
  /** Roll (rad): positive is starboard side down. */
  heel: number;
  /** Boom angle off the centreline (rad): positive swings to starboard. */
  boom: number;
  /** 0 full and drawing .. 1 flapping. */
  luff: number;
  tack: 1 | -1;
  beating: boolean;
  lastTack: number;
  phase: Phase;
  purpose: Purpose;
  route: V2[];
  mooring: number | null;
  timer: number;
  intent: Intent;
  /** Time of the last gentle bump (for a bob and a ripple). */
  bumped: number;
  readonly rand: () => number;
}

export interface Ring { x: number; z: number; strength: number }

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (a: number, b: number, t: number) => {
  const x = clamp((t - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};

/** Angle between the boat's heading and the direction the wind comes from: 0 head to wind .. π dead downwind. */
export function windAngle(heading: number): number {
  return Math.abs(wrap(heading - WIND_ANGLE));
}

/** +1 when the wind comes over the starboard side, -1 over port. */
export function windSide(heading: number): 1 | -1 {
  const fx = Math.cos(heading), fz = Math.sin(heading);
  return fx * WIND_FROM[1] - fz * WIND_FROM[0] >= 0 ? 1 : -1;
}

/** Points of sail: boat speed as a fraction of its best, by angle off the wind. */
export function polar(alpha: number): number {
  const deg = (alpha * 180) / Math.PI;
  if (deg < 40) return 0;
  if (deg <= 100) return smooth(40, 58, deg) * (0.55 + 0.45 * Math.sin((((deg - 40) / 60) * Math.PI) / 2));
  return 1 - 0.3 * Math.pow((deg - 100) / 80, 1.2);
}

export function bestSpeed(length: number): number {
  return 0.42 + 0.2 * length;
}

export function pointOfSail(b: SimBoat): string {
  switch (b.phase) {
    case 'launch': return 'launching';
    case 'moored': return 'moored';
    case 'shooting': return 'picking up';
    case 'waiting': return 'drifting';
    case 'leaving': case 'gone': return 'sailing away';
  }
  const a = windAngle(b.heading);
  if (a < NO_GO || Math.abs(b.turn) > 0.3 && b.beating) return 'tacking';
  if (a < (62 * Math.PI) / 180) return 'close-hauled';
  if (a < (125 * Math.PI) / 180) return 'reaching';
  return 'running';
}

/** Waypoints from a point to another, through the gap in the breakwater if one is in the harbour and the other at sea. */
export function routeBetween(from: V2, to: V2): V2[] {
  const a = inHarbour(from[0], from[1]), b = inHarbour(to[0], to[1]);
  if (a && !b) return [GAP_IN, GAP_OUT, to];
  if (!a && b) return [GAP_OUT, GAP_IN, to];
  return [to];
}

/** Where a boat lies on a mooring: downwind of the buoy, bow to it. */
export function mooringSpot(i: number, length: number): V2 {
  const [bx, bz] = MOORINGS[i];
  const off = length / 2 + 0.2;
  return [bx + WIND_TO[0] * off, bz + WIND_TO[1] * off];
}

/** Loops out at sea, starting and ending at the gap: a beat, reaches and a run. */
const LOOPS: readonly V2[][] = [
  [[6.8, 5.6], [9.3, 3.0], [9.4, -0.8], [6.6, 3.4]],
  [[2.0, 5.6], [-3.5, 6.0], [-6.8, 5.3], [-2.5, 4.9], [2.8, 4.6]],
  [[8.4, 6.0], [9.6, 1.2], [6.4, 4.4]],
];

export interface NewBoat {
  id: string;
  length: number;
  beam: number;
  seed: number;
  x: number;
  z: number;
  heading: number;
  intent: Intent;
  /** A freshly drawn boat waits while it is painted in. */
  launch: boolean;
}

export const LAUNCH_TIME = 2.7;

export class Sailing {
  readonly boats: SimBoat[] = [];
  time = 0;
  private acc = 0;
  /** Ripple rings since last read (bumps, picking up a mooring). */
  readonly rings: Ring[] = [];
  /** Damps heel and bob for reduced motion. */
  constructor(readonly calm = false) {}

  get(id: string): SimBoat | undefined {
    return this.boats.find((b) => b.id === id);
  }

  add(n: NewBoat): SimBoat {
    const b: SimBoat = {
      id: n.id, length: n.length, beam: n.beam,
      x: n.x, z: n.z, heading: n.heading, speed: 0, turn: 0, heel: 0, boom: 0, luff: 1,
      tack: 1, beating: false, lastTack: -99,
      phase: 'launch', purpose: 'out', route: [], mooring: null, timer: n.launch ? LAUNCH_TIME : 0,
      intent: n.intent, bumped: -99, rand: seededRandom(n.seed * 7919 + 13),
    };
    this.boats.push(b);
    if (!n.launch) {
      // restored from a save: settle straight onto a mooring if it is home, else carry on
      if (n.intent.kind === 'home' || n.intent.kind === 'free') {
        const m = this.nearestFreeMooring(b, 0.9);
        if (m !== null) {
          b.mooring = m;
          b.phase = 'moored';
          b.timer = n.intent.kind === 'home' ? Infinity : 6 + b.rand() * 14;
          return b;
        }
      }
      this.begin(b);
    }
    return b;
  }

  /** Remove: the boat sails off over the horizon and is then dropped. */
  remove(id: string): void {
    const b = this.get(id);
    if (!b || b.phase === 'leaving' || b.phase === 'gone') return;
    b.mooring = null;
    b.phase = 'leaving';
    b.purpose = 'leave';
    b.timer = 14;
    const exit: V2 = b.z > 1.5 || b.x < 4 ? [b.x * 0.6 + 2, TILE.halfZ + 2.5] : [TILE.halfX + 2.5, b.z];
    b.route = routeBetween([b.x, b.z], [4.5, 4.5]).slice(0, -1).concat([exit]);
  }

  /** Drop a boat at once (an undone drawing). */
  drop(id: string): void {
    const i = this.boats.findIndex((b) => b.id === id);
    if (i >= 0) this.boats.splice(i, 1);
  }

  setIntent(id: string, intent: Intent): void {
    const b = this.get(id);
    if (!b || b.phase === 'leaving' || b.phase === 'gone') return;
    b.intent = intent;
    if (b.phase !== 'launch') this.begin(b);
  }

  /** Advance by real time; steps at the fixed rate. */
  advance(dt: number): void {
    this.acc = Math.min(this.acc + dt, STEP * 12);
    while (this.acc >= STEP - 1e-9) {
      this.acc -= STEP;
      this.step(STEP);
    }
  }

  step(dt: number): void {
    this.time += dt;
    for (const b of this.boats) this.think(b, dt);
    for (const b of this.boats) this.move(b, dt);
    this.separate();
    for (const b of this.boats) this.keepOffLand(b);
    for (let i = this.boats.length - 1; i >= 0; i--) if (this.boats[i].phase === 'gone') this.boats.splice(i, 1);
  }

  // --- plans ---------------------------------------------------------------------------

  private begin(b: SimBoat): void {
    b.mooring = null;
    b.beating = false;
    const here: V2 = [b.x, b.z];
    switch (b.intent.kind) {
      case 'free':
      case 'out': {
        const loop = LOOPS[Math.floor(b.rand() * LOOPS.length)];
        const out = inHarbour(b.x, b.z) ? [GAP_IN, GAP_OUT] : [GAP_OUT];
        b.route = [...out, ...loop.map(([x, z]) => [x + (b.rand() - 0.5) * 0.8, z + (b.rand() - 0.5) * 0.6] as V2), GAP_OUT, GAP_IN];
        b.purpose = 'out';
        b.phase = 'sailing';
        break;
      }
      case 'home':
        this.goHome(b);
        break;
      case 'goto':
        b.route = routeBetween(here, [b.intent.x, b.intent.z]);
        b.purpose = 'goto';
        b.phase = 'sailing';
        break;
    }
  }

  private goHome(b: SimBoat): void {
    const m = this.nearestFreeMooring(b);
    if (m === null) {
      // every buoy taken: potter about in the harbour and try again later
      const spot: V2 = [-5 + b.rand() * 7, -0.5 + b.rand() * 1.6];
      b.route = routeBetween([b.x, b.z], spot);
      b.purpose = 'loiter';
      b.phase = 'sailing';
      return;
    }
    b.mooring = m;
    const [sx, sz] = mooringSpot(m, b.length);
    // come in from downwind, then shoot up into the wind onto the buoy
    const approach: V2 = [sx + WIND_TO[0] * 1.5, sz + WIND_TO[1] * 1.5];
    b.route = routeBetween([b.x, b.z], approach);
    b.purpose = 'home';
    b.phase = 'sailing';
  }

  private nearestFreeMooring(b: SimBoat, within = Infinity): number | null {
    const taken = new Set(this.boats.filter((o) => o !== b && o.mooring !== null).map((o) => o.mooring));
    let best: number | null = null, bestD = within;
    MOORINGS.forEach((_, i) => {
      if (taken.has(i)) return;
      const [sx, sz] = mooringSpot(i, b.length);
      const d = Math.hypot(sx - b.x, sz - b.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  // --- steering --------------------------------------------------------------------------

  /** How clear the water is ahead on a heading (m; negative = something in the way). */
  private clearance(b: SimBoat, h: number, edge = true): number {
    const c = Math.cos(h), s = Math.sin(h);
    let worst = Infinity;
    for (const d of [b.length * 0.5, b.length * 0.5 + 0.45, b.length * 0.5 + 1.0]) {
      const px = b.x + c * d, pz = b.z + s * d;
      let o = obstacleDistance(px, pz) - (b.beam / 2 + 0.12);
      if (edge) o = Math.min(o, edgeDistance(px, pz) - SEA_MARGIN * 0.55);
      worst = Math.min(worst, o / (0.6 + d * 0.4));
    }
    return worst;
  }

  /** The course to steer for a target: straight there, or a beat in zig-zags if it lies upwind. */
  private courseFor(b: SimBoat, tx: number, tz: number): number {
    const dx = tx - b.x, dz = tz - b.z;
    const dist = Math.hypot(dx, dz);
    const bearing = Math.atan2(dz, dx);
    if (windAngle(bearing) >= NO_GO + 0.03) {
      b.beating = false;
      return bearing;
    }
    // the target's offset across the wind from here: which side of the wind's axis it lies
    const lateral = WIND_FROM[0] * dz - WIND_FROM[1] * dx;
    const lane = clamp(dist * 0.4, 0.45, 1.7);
    if (!b.beating) {
      b.beating = true;
      // start on whichever tack is closer to the current heading, unless it points away from the target
      const near: 1 | -1 = wrap(b.heading - WIND_ANGLE) >= 0 ? 1 : -1;
      b.tack = Math.abs(lateral) > lane ? (lateral >= 0 ? 1 : -1) : near;
    } else if (b.tack * lateral < -lane * 0.5 && this.time - b.lastTack > MIN_TACK_GAP) {
      this.flipTack(b);
    }
    let course = WIND_ANGLE + b.tack * CLOSE_HAULED;
    // land, the breakwater or the paper edge ahead: tack early
    if (this.clearance(b, course) < 0 && this.time - b.lastTack > MIN_TACK_GAP * 0.6) {
      this.flipTack(b);
      course = WIND_ANGLE + b.tack * CLOSE_HAULED;
    }
    return course;
  }

  private flipTack(b: SimBoat): void {
    b.tack = b.tack === 1 ? -1 : 1;
    b.lastTack = this.time;
  }

  /** Turn the course aside from anything solid ahead, and from boats close by. */
  private avoid(b: SimBoat, course: number, edge: boolean): number {
    let out = course;
    if (this.clearance(b, course, edge) < 0) {
      let best = course, bestScore = -Infinity;
      for (let k = 1; k <= 12; k++) {
        for (const side of [1, -1]) {
          const h = course + side * k * 0.2;
          const c = this.clearance(b, h, edge);
          // prefer small turns, clear water, and courses the sail can drive on
          const score = Math.min(c, 0.4) * 3 - k * 0.12 - (windAngle(h) < NO_GO ? 0.6 : 0);
          if (score > bestScore) {
            bestScore = score;
            best = h;
          }
        }
      }
      out = best;
    }
    // other boats: bear away from any just ahead
    const fx = Math.cos(b.heading), fz = Math.sin(b.heading);
    for (const o of this.boats) {
      if (o === b || o.phase === 'gone') continue;
      const rx = o.x - b.x, rz = o.z - b.z;
      const d = Math.hypot(rx, rz);
      const reach = (b.length + o.length) * 0.5 + 0.9;
      if (d > reach || d < 1e-4) continue;
      const ahead = rx * fx + rz * fz;
      if (ahead < 0) continue;
      const lateral = -rx * fz + rz * fx;
      const push = (1 - d / reach) * (o.phase === 'moored' ? 0.9 : 0.7);
      out -= Math.sign(lateral || 1) * push;
    }
    return out;
  }

  private think(b: SimBoat, dt: number): void {
    switch (b.phase) {
      case 'launch':
        b.timer -= dt;
        if (b.timer <= 0) this.begin(b);
        return;
      case 'moored': {
        b.timer -= dt;
        if (b.timer <= 0 && b.intent.kind !== 'home') {
          b.intent = b.intent.kind === 'goto' ? { kind: 'free' } : b.intent;
          this.begin(b);
        }
        return;
      }
      case 'waiting': {
        if (b.intent.kind === 'goto') {
          if (Math.hypot(b.x - b.intent.x, b.z - b.intent.z) > 0.85) this.begin(b);
        } else {
          b.timer -= dt;
          if (b.timer <= 0) this.goHome(b);
        }
        return;
      }
      case 'shooting': {
        const [sx, sz] = mooringSpot(b.mooring ?? 0, b.length);
        const d = Math.hypot(sx - b.x, sz - b.z);
        if (d < 0.3 || (b.speed < 0.05 && d < 1.2) || b.timer <= 0) {
          b.phase = 'moored';
          b.timer = b.intent.kind === 'home' ? Infinity : 16 + b.rand() * 22;
          const [bx, bz] = MOORINGS[b.mooring ?? 0];
          this.rings.push({ x: bx, z: bz, strength: 0.6 });
        }
        b.timer -= dt;
        return;
      }
      default:
        break;
    }
    // sailing or leaving: follow the route
    const target = b.route[0];
    if (!target) {
      this.arrive(b);
      return;
    }
    const final = b.route.length === 1;
    const radius = final ? (b.purpose === 'goto' ? 0.3 : b.purpose === 'home' ? 0.5 : 0.7) : 0.75;
    if (Math.hypot(target[0] - b.x, target[1] - b.z) < radius) {
      b.route.shift();
      b.beating = false;
      if (!b.route.length) this.arrive(b);
      return;
    }
    if (b.phase === 'leaving') {
      b.timer -= dt;
      if (b.timer <= 0 || edgeDistance(b.x, b.z) < -0.6) b.phase = 'gone';
    }
  }

  private arrive(b: SimBoat): void {
    switch (b.purpose) {
      case 'out':
        this.goHome(b);
        break;
      case 'home':
        b.phase = 'shooting';
        b.timer = 9;
        break;
      case 'goto':
        b.phase = 'waiting';
        break;
      case 'loiter':
        b.phase = 'waiting';
        b.timer = 6 + b.rand() * 6;
        break;
      case 'leave':
        b.phase = 'gone';
        break;
    }
  }

  private move(b: SimBoat, dt: number): void {
    const W = windStrength(this.time);
    const vmax = bestSpeed(b.length);
    let course = b.heading;
    let drive = 0;
    let leeway = 0.02;
    let luffForced = false;
    switch (b.phase) {
      case 'sailing':
      case 'leaving': {
        const t = b.route[0] ?? [b.x, b.z];
        course = this.avoid(b, this.courseFor(b, t[0], t[1]), b.phase !== 'leaving');
        drive = 1;
        // ease off when closing on a spot to wait at
        if (b.route.length === 1 && b.purpose === 'goto') drive = 0.35 + 0.65 * smooth(0.2, 1.4, Math.hypot(t[0] - b.x, t[1] - b.z));
        break;
      }
      case 'shooting': {
        // head to wind, coasting up to the buoy on the way she's carrying, sail flapping
        const [sx, sz] = mooringSpot(b.mooring ?? 0, b.length);
        const toward = Math.atan2(sz - b.z, sx - b.x);
        course = WIND_ANGLE + clamp(wrap(toward - WIND_ANGLE), -0.5, 0.5);
        luffForced = true;
        // a little creep, as if the crew were pulling her up to the buoy
        b.speed = Math.max(b.speed, 0.07);
        break;
      }
      case 'moored': {
        const [sx, sz] = mooringSpot(b.mooring ?? 0, b.length);
        const swing = Math.sin(this.time * 0.3 + b.length * 9) * 0.18;
        course = WIND_ANGLE + swing;
        const k = 1 - Math.exp(-dt / 1.6);
        b.x += (sx + Math.sin(swing) * 0.05 - b.x) * k;
        b.z += (sz - b.z) * k;
        b.speed *= 1 - k;
        luffForced = true;
        leeway = 0;
        break;
      }
      case 'waiting':
      case 'launch':
        // lying quietly, sail let go, drifting a little downwind
        course = b.phase === 'waiting' ? WIND_ANGLE + 0.95 * (b.tack || 1) : b.heading;
        luffForced = true;
        leeway = b.phase === 'waiting' ? 0.035 : 0.01;
        break;
      default:
        break;
    }

    // the helm: a turn rate that needs way on to bite
    const diff = wrap(course - b.heading);
    const maxRate = 0.95 * (0.38 + 0.62 * Math.min(1, b.speed / 0.3));
    const want = clamp(diff * 1.8, -maxRate, maxRate);
    b.turn += (want - b.turn) * (1 - Math.exp(-dt / 0.28));
    b.heading = wrap(b.heading + b.turn * dt);

    // speed from the points of sail
    const alpha = windAngle(b.heading);
    const target = drive * polar(alpha) * W * vmax;
    const tau = target > b.speed ? 1.7 : alpha < NO_GO ? 2.6 : 1.1;
    b.speed += (target - b.speed) * (1 - Math.exp(-dt / tau));
    if (b.phase === 'moored') b.speed = 0;
    b.x += Math.cos(b.heading) * b.speed * dt + WIND_TO[0] * leeway * W * dt;
    b.z += Math.sin(b.heading) * b.speed * dt + WIND_TO[1] * leeway * W * dt;

    // the sail: drawing when there's an angle on the wind, flapping head-to-wind or let go
    const luff = luffForced ? 1 : 1 - smooth(0.5, 0.8, alpha);
    b.luff += (luff - b.luff) * (1 - Math.exp(-dt / 0.35));
    const side = windSide(b.heading);
    const sheet = luffForced ? 0.06 : 0.24 + 1.15 * smooth(0.7, 2.9, alpha);
    // the boom swings out to leeward; through a tack it crosses the boat
    const boomTarget = -side * sheet;
    const rate = 1.9;
    b.boom += clamp(boomTarget - b.boom, -rate * dt, rate * dt);
    // heel to leeward, more in the gusts and on a reach, none when the sail is flapping
    const force = W * W * Math.sin(alpha) * (alpha < 2.2 ? 1 : 0.45) * (1 - b.luff) * smooth(0.0, 0.25, b.speed + 0.05);
    const heel = -side * force * (this.calm ? 0.07 : 0.2);
    b.heel += (heel - b.heel) * (1 - Math.exp(-dt / 0.7));
  }

  /** Boats bump gently instead of passing through each other. */
  private separate(): void {
    const bs = this.boats;
    for (let i = 0; i < bs.length; i++) {
      for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i], b = bs[j];
        const ra = a.length * 0.36 + a.beam * 0.2, rb = b.length * 0.36 + b.beam * 0.2;
        const dx = b.x - a.x, dz = b.z - a.z;
        const d = Math.hypot(dx, dz) || 1e-4;
        const overlap = ra + rb - d;
        if (overlap <= 0) continue;
        const nx = dx / d, nz = dz / d;
        const wa = a.phase === 'moored' ? 0.3 : 0.5, wb = b.phase === 'moored' ? 0.3 : 0.5;
        const k = overlap / (wa + wb);
        a.x -= nx * k * wa * 0.5;
        a.z -= nz * k * wa * 0.5;
        b.x += nx * k * wb * 0.5;
        b.z += nz * k * wb * 0.5;
        if (overlap > 0.04 && this.time - Math.max(a.bumped, b.bumped) > 1.4) {
          a.bumped = b.bumped = this.time;
          a.speed *= 0.6;
          b.speed *= 0.6;
          this.rings.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, strength: 0.9 });
        }
      }
    }
  }

  /** Bow, stern and middle are kept off the land, the quay, the breakwater and the rocks. */
  private keepOffLand(b: SimBoat): void {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const c = Math.cos(b.heading), s = Math.sin(b.heading);
      for (const [off, room] of [[0, b.beam * 0.45], [b.length * 0.47, 0.03], [-b.length * 0.45, b.beam * 0.25]] as const) {
        const px = b.x + c * off, pz = b.z + s * off;
        const d = obstacleDistance(px, pz) - room;
        if (d >= 0) continue;
        const [gx, gz] = obstacleGradient(px, pz);
        b.x += gx * (-d + 0.002);
        b.z += gz * (-d + 0.002);
        b.speed *= 0.92;
        moved = true;
      }
      if (!moved) break;
    }
  }

  /** Read and clear the ripple rings raised since the last call. */
  takeRings(): Ring[] {
    return this.rings.splice(0);
  }
}
