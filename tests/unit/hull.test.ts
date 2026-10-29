import { describe, expect, test } from 'vitest';
import {
  BEAM_RATIO, LENGTH_RANGE, MAX_OUTLINE, closeLoop, parametricLoop, polygonArea, shapeFromLoop, shapeFromOutline, stations, validOutline, type V2,
} from '../../src/boat/hull';

/** A teardrop: round at the stern (t = 0), pointed at the bow (t = 1). */
const teardrop = (t: number) => 0.32 * Math.sin(Math.PI * Math.pow(t, 0.6)) * (1 - 0.15 * t);
const ellipse = (t: number) => 0.5 * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
const angleDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

function hullOf(loop: V2[]) {
  const r = shapeFromLoop(loop);
  if (!r.ok) throw new Error(`rejected: ${r.reason}`);
  return r.hull;
}

describe('closed loops', () => {
  test('accepts a loop whose ends meet, and rejects an open arc', () => {
    // Arrange
    const loop = parametricLoop(0, 0, 0, 1.4, teardrop);
    const arc = loop.slice(0, Math.round(loop.length * 0.6));
    // Act / Assert
    expect(closeLoop(loop)).not.toBeNull();
    expect(closeLoop(arc)).toBeNull();
    expect(shapeFromLoop(arc)).toEqual({ ok: false, reason: 'open' });
  });

  test('trims a loop drawn past its start', () => {
    const loop = parametricLoop(0, 0, 0, 1.4, ellipse);
    const over = [...loop, ...loop.slice(0, 8)];
    const closed = closeLoop(over)!;
    expect(closed.length).toBeLessThanOrEqual(loop.length + 2);
  });

  test('rejects tiny scribbles', () => {
    const tiny = parametricLoop(0, 0, 0, 0.2, (t) => ellipse(t) * 0.1);
    expect(shapeFromLoop(tiny)).toEqual({ ok: false, reason: 'small' });
  });
});

describe('bow detection', () => {
  test.each([0, 0.9, 2.2, -1.4, Math.PI])('finds the pointed end of a teardrop drawn at heading %s', (heading) => {
    const hull = hullOf(parametricLoop(1, -2, heading, 1.4, teardrop));
    expect(angleDiff(hull.heading, heading)).toBeLessThan(0.15);
  });

  test('the bow is narrower than the stern in the outline', () => {
    const hull = hullOf(parametricLoop(0, 0, 0.4, 1.5, teardrop));
    const st = stations(hull.outline);
    const w = (i: number) => st[i].port + st[i].starboard;
    expect(w(st.length - 3)).toBeLessThan(w(2));
  });

  test('keeps the hull where it was drawn', () => {
    const hull = hullOf(parametricLoop(3, 1.5, 1.1, 1.4, ellipse));
    expect(Math.hypot(hull.center[0] - 3, hull.center[1] - 1.5)).toBeLessThan(0.05);
  });
});

describe('symmetrising', () => {
  test('a lopsided drawing becomes mostly, not perfectly, symmetric', () => {
    // one side bulges much more than the other
    const lop = (t: number) => teardrop(t);
    const loop = parametricLoop(0, 0, 0, 1.4, lop).map(([x, z]) => [x, z > 0 ? z * 1.6 : z] as V2);
    const hull = hullOf(loop);
    const st = stations(hull.outline);
    const mid = st[Math.floor(st.length / 2)];
    const imbalance = Math.abs(mid.port - mid.starboard) / (mid.port + mid.starboard);
    expect(imbalance).toBeGreaterThan(0.01); // its personality survives
    expect(imbalance).toBeLessThan(0.12);
  });

  test('keeps the area within bounds', () => {
    for (const shape of [teardrop, ellipse, (t: number) => 0.3 + 0.1 * Math.sin(t * 9)]) {
      const loop = parametricLoop(0, 0, 0.3, 1.3, shape);
      const hull = hullOf(loop);
      const ratio = Math.abs(polygonArea(hull.outline)) / Math.abs(polygonArea(loop));
      expect(ratio).toBeGreaterThan(0.75);
      expect(ratio).toBeLessThan(1.25);
    }
  });

  test('outline is resampled to at most 48 points', () => {
    const hull = hullOf(parametricLoop(0, 0, 0, 1.4, teardrop, 400));
    expect(hull.outline.length).toBeLessThanOrEqual(MAX_OUTLINE);
  });
});

describe('size clamping', () => {
  test('huge and small drawings are brought into range', () => {
    const big = hullOf(parametricLoop(0, 0, 0, 6, teardrop.bind(null)));
    expect(big.length).toBeCloseTo(LENGTH_RANGE[1], 5);
    const small = hullOf(parametricLoop(0, 0, 0, 0.5, (t) => ellipse(t) * 0.5));
    expect(small.length).toBeCloseTo(LENGTH_RANGE[0], 5);
  });

  test('a circle becomes tubby but still a boat; a sliver becomes sleek but still a boat', () => {
    const round = hullOf(parametricLoop(0, 0, 0, 1.2, (t) => ellipse(t) * 1.2));
    expect(round.beam / round.length).toBeLessThanOrEqual(BEAM_RATIO[1] + 0.01);
    const thin = hullOf(parametricLoop(0, 0, 0, 1.6, (t) => ellipse(t) * 0.16));
    expect(thin.beam / thin.length).toBeGreaterThanOrEqual(BEAM_RATIO[0] - 0.01);
  });

  test('saved outlines round-trip and are validated', () => {
    const hull = hullOf(parametricLoop(0, 0, 0, 1.4, teardrop));
    expect(validOutline(hull.outline)).toBe(true);
    expect(shapeFromOutline(hull.outline).length).toBeCloseTo(hull.length, 1);
    expect(validOutline([[0, 0], [1, 1]])).toBe(false);
    expect(validOutline(hull.outline.map(([u, v]) => [u * 10, v]))).toBe(false);
    expect(validOutline('boat')).toBe(false);
  });
});
