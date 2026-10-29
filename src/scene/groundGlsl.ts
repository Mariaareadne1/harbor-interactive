import { CHAPEL, HOUSES, LIGHTHOUSE, QUAY, TILE } from './harbour';

/**
 * The painted land: a grassy hillside of terraces behind a paved stone quay,
 * low stone walls holding the terraces up, a stair lane climbing between the
 * houses, a little sandy beach at the left, and a rocky, grassy headland out
 * to the lighthouse. The coast itself comes from the harbour map (map.ts);
 * only the layout numbers are written in here. The terrain bakes this once.
 */

const f = (n: number) => n.toFixed(4);

interface Box { x: number; z: number; hu: number; hv: number; rot: number }

function boxFn(name: string, b: Box): string {
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  return `float ${name}(vec2 p) {
  vec2 d = p - vec2(${f(b.x)}, ${f(b.z)});
  vec2 l = abs(vec2(${f(c)} * d.x - ${f(s)} * d.y, ${f(s)} * d.x + ${f(c)} * d.y));
  vec2 q = l - vec2(${f(b.hu)}, ${f(b.hv)});
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}`;
}

const footprints: Box[] = [
  ...HOUSES.map((h) => ({ x: h.x, z: h.z, hu: h.w / 2, hv: h.d / 2, rot: h.rot })),
  { x: CHAPEL.x, z: CHAPEL.z, hu: CHAPEL.w / 2, hv: CHAPEL.d / 2, rot: CHAPEL.rot },
  { x: LIGHTHOUSE.x, z: LIGHTHOUSE.z, hu: LIGHTHOUSE.radius, hv: LIGHTHOUSE.radius, rot: 0 },
];
const footFns = footprints.map((b, i) => boxFn(`foot${i}`, b)).join('\n');
const footPick = footprints.map((_, i) => `  d = min(d, foot${i}(p));`).join('\n');

export const GROUND_GLSL = /* glsl */ `
const float HALF_X = ${f(TILE.halfX)};
const float HALF_Z = ${f(TILE.halfZ)};

vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
float segD(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
float quayZ(float x) { float cx = clamp(x, ${f(QUAY.x0)}, ${f(QUAY.x1)}); return -3.92 + 0.0185 * (cx + 1.8) * (cx + 1.8); }
${footFns}
float footDist(vec2 p) {
  float d = 99.0;
${footPick}
  return d;
}

vec3 grassPaint(vec2 xz) {
  float wash = fbm2lite(xz * 0.13 + 4.0);
  vec3 c = mix(srgb(vec3(0.55, 0.73, 0.36)), srgb(vec3(0.68, 0.79, 0.4)), smoothstep(0.3, 0.75, wash));
  float glow = fbm2lite(xz * 0.1 - 2.0);
  c = mix(c, c * vec3(1.1, 1.08, 0.88) + srgb(vec3(0.06, 0.05, 0.0)), smoothstep(0.5, 0.8, glow) * 0.6);
  float stroke = vnoise(vec2(xz.x * 0.7, xz.y * 7.5)) * 0.65 + vnoise(vec2(xz.x * 2.0, xz.y * 17.0)) * 0.35;
  return c * (0.93 + 0.13 * stroke);
}

vec3 stonePaint(vec2 xz, float scale, vec3 base) {
  // flagstones: offset courses, each slab its own warm grey, a darker joint
  vec2 q = xz * scale;
  float row = floor(q.y);
  q.x += row * 0.5;
  vec2 cell = floor(q);
  vec2 fr = fract(q);
  float slab = hash12(cell + 3.0);
  vec3 c = base * (0.9 + 0.16 * slab);
  c = mix(c, c * vec3(1.04, 1.0, 0.92), step(0.7, hash12(cell + 9.0)) * 0.6);
  float joint = smoothstep(0.06, 0.0, min(min(fr.x, 1.0 - fr.x), min(fr.y, 1.0 - fr.y)) - 0.01);
  c *= 1.0 - 0.22 * joint;
  return c * (0.95 + 0.08 * vnoise(xz * 9.0));
}

vec3 sandPaint(vec2 xz, float wet) {
  vec3 c = mix(srgb(vec3(0.93, 0.84, 0.66)), srgb(vec3(0.8, 0.69, 0.53)), wet);
  c *= 0.95 + 0.08 * vnoise(xz * 2.0) + 0.04 * vnoise(xz * 13.0);
  float ripple = sin(xz.x * 7.0 + xz.y * 3.0 + vnoise(xz * 1.5) * 2.0);
  c *= 1.0 + 0.025 * ripple;
  return c;
}

vec3 rockPaint(vec2 xz) {
  float n = fbm2lite(xz * 1.6);
  vec3 c = mix(srgb(vec3(0.62, 0.6, 0.62)), srgb(vec3(0.76, 0.69, 0.58)), smoothstep(0.35, 0.7, n));
  // cracks and lichen dabs
  c *= 1.0 - 0.2 * smoothstep(0.04, 0.0, abs(vnoise(xz * 4.0) - 0.5));
  c = mix(c, srgb(vec3(0.85, 0.75, 0.38)), step(0.97, hash12(floor(xz * 16.0))) * 0.6);
  return c;
}

/** The land's base paint at a point, before light. grassy = 1 where flowers can fleck. */
vec3 groundPaint(vec2 xz, vec4 m, out float grassy) {
  float coast = m.r;
  float inland = -coast;
  vec3 c = grassPaint(xz);
  grassy = 1.0;
  bool town = xz.x > ${f(QUAY.x0 - 0.15)} && xz.x < ${f(QUAY.x1 + 0.15)};
  float s = quayZ(xz.x) - xz.y;

  if (town) {
    // the quay road: big warm flagstones out to the edge, a darker kerb of dressed stone
    float onQuay = 1.0 - smoothstep(${f(QUAY.width - 0.04)}, ${f(QUAY.width + 0.06)}, s + (vnoise(xz * 3.0) - 0.5) * 0.06);
    vec3 paving = stonePaint(vec2(xz.x, s), 4.2, srgb(vec3(0.86, 0.8, 0.7)));
    paving = mix(paving, srgb(vec3(0.72, 0.68, 0.64)) * (0.92 + 0.1 * hash12(floor(vec2(xz.x * 3.0, 0.0)))), smoothstep(0.16, 0.12, s));
    c = mix(c, paving, onQuay);
    grassy *= 1.0 - onQuay;
    // terrace walls: low retaining walls of stone at each step up the hill
    for (int i = 0; i < 3; i++) {
      float at = 2.15 + float(i) * 1.22;
      float wall = 1.0 - smoothstep(0.12, 0.2, abs(s - at));
      c = mix(c, stonePaint(vec2(xz.x, s * 3.0), 6.0, srgb(vec3(0.79, 0.73, 0.64))), wall);
      grassy *= 1.0 - wall;
    }
    // pale gravel round the houses on each terrace
    float yard = smoothstep(0.55, 0.2, footDist(xz)) * step(${f(QUAY.width)}, s);
    c = mix(c, srgb(vec3(0.84, 0.79, 0.68)) * (0.94 + 0.1 * vnoise(xz * 12.0)), yard * 0.7);
    grassy *= 1.0 - yard;
  }
  // the stair lane climbing up through the town, and a path up to the chapel
  float lane = min(segD(xz, vec2(-1.3, -4.7), vec2(-1.15, -9.0)), min(segD(xz, vec2(-7.6, -4.0), vec2(-9.2, -5.6)), segD(xz, vec2(-8.15, -3.2), vec2(-7.6, -4.0))));
  float onLane = 1.0 - smoothstep(0.18, 0.24, lane + (vnoise(xz * 4.0) - 0.5) * 0.04);
  vec3 steps = srgb(vec3(0.84, 0.78, 0.68)) * (0.92 + 0.12 * step(0.5, fract(xz.y * 5.0)));
  c = mix(c, steps, onLane * step(0.3, inland));
  grassy *= 1.0 - onLane;
  // the path out along the headland to the lighthouse
  float lp = segD(xz, vec2(${f(QUAY.x1)}, -3.3), vec2(${f(LIGHTHOUSE.x - 0.1)}, ${f(LIGHTHOUSE.z - 0.3)}));
  float onPath = 1.0 - smoothstep(0.12, 0.18, lp + (vnoise(xz * 4.0) - 0.5) * 0.05);
  c = mix(c, srgb(vec3(0.88, 0.81, 0.66)) * (0.94 + 0.08 * vnoise(xz * 10.0)), onPath);
  grassy *= 1.0 - onPath;

  // the beach: dry sand up top, wet and darker at the water's edge
  float beach = m.a * (1.0 - smoothstep(1.3, 1.9, inland + (vnoise(xz * 1.6) - 0.5) * 0.5));
  float wet = smoothstep(0.35, 0.0, inland);
  c = mix(c, sandPaint(xz, wet), beach);
  grassy *= 1.0 - beach;

  // rocky shores on the headland and at the breakwater's root
  float rocky = (1.0 - m.a) * (town ? 0.0 : 1.0) * (1.0 - smoothstep(0.35, 0.75, inland + (vnoise(xz * 2.5) - 0.5) * 0.4));
  c = mix(c, rockPaint(xz), rocky);
  grassy *= 1.0 - rocky;

  // a soft painted shade hugging every building
  float fd = footDist(xz);
  c = mix(c, c * vec3(0.93, 0.9, 0.88), smoothstep(0.25, 0.03, fd) * 0.45);
  return c;
}

/** Signed distance inside the tile's rounded edge, roughened like dry-brush paint. */
float paintEdge(vec2 xz) {
  vec2 q = abs(xz) - vec2(HALF_X, HALF_Z) + 1.0;
  float box = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 1.0;
  float rough = (vnoise(xz * 1.1) - 0.5) * 0.5 + (vnoise(xz * 4.0) - 0.5) * 0.24;
  return -box + rough;
}
`;
