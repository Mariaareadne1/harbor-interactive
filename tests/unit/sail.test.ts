import { describe, expect, test } from 'vitest';
import { NO_GO, Sailing, mooringSpot, polar, routeBetween, windAngle, type SimBoat } from '../../src/sail/sim';
import { GAP_IN, GAP_OUT, MOORINGS, WIND_FROM, inHarbour, obstacleDistance } from '../../src/scene/harbour';

const deg = (d: number) => (d * Math.PI) / 180;
const WIND = Math.atan2(WIND_FROM[1], WIND_FROM[0]);

function run(s: Sailing, seconds: number, each?: (t: number) => void): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    s.step(1 / 60);
    each?.(i / 60);
  }
}

function boat(s: Sailing, id: string, x: number, z: number, heading: number, intent: SimBoat['intent'], length = 1.3): SimBoat {
  return s.add({ id, length, beam: length * 0.4, seed: id.length * 31 + 7, x, z, heading, intent, launch: false });
}

describe('points of sail', () => {
  test('no drive in the no-go zone, fastest on a beam reach, slower running', () => {
    expect(polar(deg(0))).toBe(0);
    expect(polar(deg(35))).toBe(0);
    const close = polar(deg(50)), beam = polar(deg(95)), run_ = polar(deg(178));
    expect(close).toBeGreaterThan(0);
    expect(beam).toBeGreaterThan(close);
    expect(beam).toBeGreaterThan(run_);
    expect(run_).toBeGreaterThan(0.5);
    for (let d = 0; d <= 180; d += 2) {
      expect(polar(deg(d))).toBeGreaterThanOrEqual(0);
      expect(polar(deg(d))).toBeLessThanOrEqual(1);
    }
  });

  test('wind angle is 0 head to wind and π running', () => {
    expect(windAngle(WIND)).toBeCloseTo(0, 6);
    expect(windAngle(WIND + Math.PI)).toBeCloseTo(Math.PI, 6);
  });
});

describe('routing', () => {
  test('goes through the gap between harbour and sea', () => {
    expect(inHarbour(GAP_IN[0], GAP_IN[1])).toBe(true);
    expect(inHarbour(GAP_OUT[0], GAP_OUT[1])).toBe(false);
    expect(routeBetween([-3, 0], [8, 5])).toEqual([GAP_IN, GAP_OUT, [8, 5]]);
    expect(routeBetween([8, 5], [-3, 0])).toEqual([GAP_OUT, GAP_IN, [-3, 0]]);
    expect(routeBetween([-3, 0], [0, -1])).toEqual([[0, -1]]);
  });
});

describe('tacking', () => {
  test('a boat sent upwind beats there in zig-zags and arrives', () => {
    const s = new Sailing();
    // out at sea, sent to a point dead upwind of it
    const start: [number, number] = [5.5, 5.8];
    const tx = start[0] + WIND_FROM[0] * 4.2, tz = start[1] + WIND_FROM[1] * 4.2;
    const b = boat(s, 'beat', start[0], start[1], WIND + Math.PI / 2, { kind: 'goto', x: tx, z: tz });
    let tacks = 0;
    let lastSide = Math.sign(Math.sin(b.heading - WIND));
    let maxGoodHeading = 0;
    run(s, 90, () => {
      if (b.phase !== 'sailing') return;
      const side = Math.sign(Math.sin(b.heading - WIND));
      if (side !== 0 && side !== lastSide) {
        tacks++;
        lastSide = side;
      }
      // while it's moving it never points into the no-go zone for long
      if (b.speed > 0.2) maxGoodHeading = Math.max(maxGoodHeading, windAngle(b.heading) < NO_GO - 0.12 ? 1 : 0);
    });
    expect(tacks).toBeGreaterThanOrEqual(2);
    expect(b.phase).toBe('waiting');
    expect(Math.hypot(b.x - tx, b.z - tz)).toBeLessThan(0.9);
  });

  test('a boat sent across the wind sails straight there without tacking', () => {
    const s = new Sailing();
    const b = boat(s, 'reach', -6, -1.5, 0.69, { kind: 'goto', x: -2, z: 1.8 });
    let tacks = 0;
    let lastSide = Math.sign(Math.sin(b.heading - WIND));
    run(s, 30, () => {
      const side = Math.sign(Math.sin(b.heading - WIND));
      if (side !== lastSide && b.phase === 'sailing') tacks++;
      lastSide = side;
    });
    expect(tacks).toBe(0);
    expect(Math.hypot(b.x + 2, b.z - 1.8)).toBeLessThan(0.9);
  });
});

describe('the harbour', () => {
  test('boats out on their loops never touch land, the quay, the breakwater or the rocks', () => {
    const s = new Sailing();
    const starts: [number, number][] = [[-6, 0], [-3, -1.5], [0, 0.5], [2.5, -1], [-1, 1.8], [5, 5.5], [8.8, 2]];
    starts.forEach(([x, z], i) => boat(s, `b${i}`, x, z, i, { kind: 'out' }, 0.8 + i * 0.15));
    let worst = Infinity;
    run(s, 180, () => {
      for (const b of s.boats) {
        const c = Math.cos(b.heading), sn = Math.sin(b.heading);
        for (const off of [0, b.length * 0.47, -b.length * 0.45]) worst = Math.min(worst, obstacleDistance(b.x + c * off, b.z + sn * off));
      }
    });
    expect(worst).toBeGreaterThanOrEqual(-0.01);
  }, 60_000);

  test('a boat told to come home picks up a free mooring, head to wind', () => {
    const s = new Sailing();
    const b = boat(s, 'home', 6.5, 5.0, Math.PI, { kind: 'home' });
    run(s, 120);
    expect(b.phase).toBe('moored');
    const [sx, sz] = mooringSpot(b.mooring!, b.length);
    expect(Math.hypot(b.x - sx, b.z - sz)).toBeLessThan(0.3);
    expect(windAngle(b.heading)).toBeLessThan(0.35);
    expect(b.luff).toBeGreaterThan(0.8);
  });

  test('two boats never share a mooring', () => {
    const s = new Sailing();
    for (let i = 0; i < MOORINGS.length + 2; i++) boat(s, `m${i}`, -6 + i, 0.2 + (i % 2) * 0.8, 0, { kind: 'home' }, 0.9);
    run(s, 5);
    const taken = s.boats.map((b) => b.mooring).filter((m) => m !== null);
    expect(new Set(taken).size).toBe(taken.length);
  });

  test('the same steps always sail the same way', () => {
    const go = () => {
      const s = new Sailing();
      boat(s, 'a', -4, 0, 0, { kind: 'out' });
      boat(s, 'b', 1, -1, 2, { kind: 'free' });
      run(s, 40);
      return s.boats.map((b) => [b.x, b.z, b.heading].map((v) => v.toFixed(6)).join());
    };
    expect(go()).toEqual(go());
  });

  test('a removed boat sails off the tile and is gone', () => {
    const s = new Sailing();
    boat(s, 'bye', 0, 0, 0, { kind: 'free' });
    s.remove('bye');
    run(s, 40);
    expect(s.get('bye')).toBeUndefined();
  });

  test('boats bump instead of passing through each other', () => {
    const s = new Sailing();
    const a = boat(s, 'x', -3, 0, 0, { kind: 'goto', x: 1, z: 0 });
    const b = boat(s, 'y', 1, 0, Math.PI, { kind: 'goto', x: -3, z: 0 });
    let closest = Infinity;
    run(s, 25, () => (closest = Math.min(closest, Math.hypot(a.x - b.x, a.z - b.z))));
    expect(closest).toBeGreaterThan(0.6);
  });
});
