import * as THREE from 'three';
import {
  BREAKWATER, BREAKWATER_HALF, BREAKWATER_Y, CHAPEL, HOUSES, LIGHTHOUSE, QUAY_LINE, QUAY_Y, ROOF_OVERHANG, landHeight, type House,
} from './harbour';
import { LIGHTING_GLSL, NOISE_GLSL, WORLD_UNIFORMS_GLSL } from './shaderChunks';
import { SHADOW_LAYER } from '../engine/shadows';
import type { WorldUniforms } from './world';

/**
 * Everything built of stone and plaster, in one painted mesh: the stacked
 * pastel houses with terracotta roofs and shutters, the café's striped
 * awning, the chapel and its bell tower, the curved quay wall, the
 * breakwater's big blocks and the lighthouse. Faces carry what they are and
 * their own surface coordinates, so the shader can paint windows, shutters,
 * doors, tile courses and stone courses the way an illustrator would.
 */

// what a face is, for the shader (aPaint.x)
const WALL = 1, FRONT = 2, GABLE = 3, ROOF = 4, TRIM = 5, TOWER = 6, AWNING = 7, CHAPEL_WALL = 8, QUAYWALL = 9, BREAK = 10, LIGHT = 11, LANTERN = 12;

class Builder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly col: number[] = [];
  readonly trim: number[] = [];
  readonly paint: number[] = [];
  private readonly c = new THREE.Color();
  private readonly t = new THREE.Color();
  private readonly v = new THREE.Vector3();
  private readonly n = new THREE.Vector3();
  trimHex = '#5f8f7a';

  constructor(readonly m: THREE.Matrix4, readonly nm: THREE.Matrix3) {}

  /** A flat polygon (fan-triangulated), its local face coordinates per vertex. */
  face(verts: [number, number, number][], uv: [number, number][], kind: number, len: number, hex: string): void {
    const [a, b, c] = verts;
    const ab = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const ac = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    this.n.crossVectors(ab, ac).normalize().applyMatrix3(this.nm).normalize();
    this.c.set(hex);
    this.t.set(this.trimHex);
    for (let i = 1; i < verts.length - 1; i++) {
      for (const k of [0, i, i + 1]) {
        this.v.set(...verts[k]).applyMatrix4(this.m);
        this.pos.push(this.v.x, this.v.y, this.v.z);
        this.nrm.push(this.n.x, this.n.y, this.n.z);
        this.col.push(this.c.r, this.c.g, this.c.b);
        this.trim.push(this.t.r, this.t.g, this.t.b);
        this.paint.push(kind, uv[k][0], uv[k][1], len);
      }
    }
  }

  /** A quad with smooth per-vertex normals (for round things: the lighthouse). */
  smoothQuad(p: THREE.Vector3[], nrm: THREE.Vector3[], uv: [number, number][], kind: number, len: number, hex: string): void {
    this.c.set(hex);
    this.t.set(this.trimHex);
    for (const k of [0, 1, 2, 0, 2, 3]) {
      this.v.copy(p[k]).applyMatrix4(this.m);
      this.n.copy(nrm[k]).applyMatrix3(this.nm).normalize();
      this.pos.push(this.v.x, this.v.y, this.v.z);
      this.nrm.push(this.n.x, this.n.y, this.n.z);
      this.col.push(this.c.r, this.c.g, this.c.b);
      this.trim.push(this.t.r, this.t.g, this.t.b);
      this.paint.push(kind, uv[k][0], uv[k][1], len);
    }
  }

  /** Four upright walls of a box from y0 to y1, outward faces (+z, +x, -z, -x). */
  walls(hx: number, hz: number, y0: number, y1: number, kinds: [number, number, number, number], hex: string): void {
    const h = y1 - y0;
    const sides: [[number, number], [number, number], number][] = [
      [[-hx, hz], [hx, hz], kinds[0]],
      [[hx, hz], [hx, -hz], kinds[1]],
      [[hx, -hz], [-hx, -hz], kinds[2]],
      [[-hx, -hz], [-hx, hz], kinds[3]],
    ];
    for (const [p, q, kind] of sides) {
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      this.face([[p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]]], [[0, y0], [len, y0], [len, h + y0], [0, h + y0]], kind, len, hex);
    }
  }

  top(hx: number, hz: number, y: number, kind: number, hex: string): void {
    this.face([[-hx, y, hz], [hx, y, hz], [hx, y, -hz], [-hx, y, -hz]], [[0, 0], [1, 0], [1, 1], [0, 1]], kind, 1, hex);
  }
}

function placed(x: number, y: number, z: number, rot: number): Builder {
  const m = new THREE.Matrix4().makeRotationY(rot).setPosition(x, y, z);
  return new Builder(m, new THREE.Matrix3().getNormalMatrix(m));
}

function geometryFrom(b: Builder[]): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const cat = (k: 'pos' | 'nrm' | 'col' | 'trim' | 'paint') => b.flatMap((x) => x[k]);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(cat('pos'), 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(cat('nrm'), 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cat('col'), 3));
  geo.setAttribute('aTrim', new THREE.Float32BufferAttribute(cat('trim'), 3));
  geo.setAttribute('aPaint', new THREE.Float32BufferAttribute(cat('paint'), 4));
  geo.computeBoundingSphere();
  return geo;
}

/** A gabled building: walls, gable ends, two roof slopes with an overhang and eave boards. Front faces +z. */
function gabled(b: Builder, w: number, d: number, wallH: number, roofH: number, wallKind: number, frontKind: number, wallHex: string, roofHex: string): void {
  const hx = w / 2, hz = d / 2, o = ROOF_OVERHANG;
  b.walls(hx, hz, -0.3, wallH, [frontKind, GABLE, wallKind, GABLE], wallHex);
  const ridge = wallH + roofH;
  b.face([[hx, wallH, hz], [hx, wallH, -hz], [hx, ridge, 0]], [[0, wallH], [d, wallH], [hz, ridge]], GABLE, d, wallHex);
  b.face([[-hx, wallH, -hz], [-hx, wallH, hz], [-hx, ridge, 0]], [[0, wallH], [d, wallH], [hz, ridge]], GABLE, d, wallHex);
  const slope = roofH / hz;
  const eaveY = wallH - slope * o;
  const run = Math.hypot(hz + o, roofH + slope * o);
  const ux = hx + o;
  b.face([[-ux, ridge, 0], [-ux, eaveY, hz + o], [ux, eaveY, hz + o], [ux, ridge, 0]], [[0, 0], [0, run], [2 * ux, run], [2 * ux, 0]], ROOF, 2 * ux, roofHex);
  b.face([[ux, ridge, 0], [ux, eaveY, -hz - o], [-ux, eaveY, -hz - o], [-ux, ridge, 0]], [[0, 0], [0, run], [2 * ux, run], [2 * ux, 0]], ROOF, 2 * ux, roofHex);
  const t = 0.04;
  for (const s of [1, -1]) {
    const ez = s * (hz + o);
    b.face([[-ux, eaveY, ez], [ux, eaveY, ez], [ux, eaveY - t, ez], [-ux, eaveY - t, ez]], [[0, 0], [1, 0], [1, 1], [0, 1]], TRIM, 1, '#f4efe6');
    for (const x of [ux, -ux]) b.face([[x, ridge, 0], [x, eaveY, ez], [x, eaveY - t, ez], [x, ridge - t, 0]], [[0, 0], [1, 0], [1, 1], [0, 1]], TRIM, 1, '#f4efe6');
  }
}

function house(h: House): Builder {
  const b = placed(h.x, h.y, h.z, h.rot);
  b.trimHex = h.shutters;
  gabled(b, h.w, h.d, h.wallH, h.roofH, WALL, FRONT, h.wall, h.roof);
  if (h.cafe) {
    // a striped awning over the café's ground floor, sloping out over the quay
    const hx = h.w / 2 - 0.04, z0 = h.d / 2, y0 = 0.36, out = 0.36, drop = 0.12;
    b.trimHex = '#d4574a';
    b.face([[-hx, y0, z0], [-hx, y0 - drop, z0 + out], [hx, y0 - drop, z0 + out], [hx, y0, z0]], [[0, 0], [0, 1], [2 * hx, 1], [2 * hx, 0]], AWNING, 2 * hx, '#f6f0e4');
    b.face([[-hx, y0 - drop, z0 + out], [-hx, y0 - drop - 0.05, z0 + out], [hx, y0 - drop - 0.05, z0 + out], [hx, y0 - drop, z0 + out]], [[0, 0], [0, 1], [2 * hx, 1], [2 * hx, 0]], AWNING, 2 * hx, '#f6f0e4');
  }
  return b;
}

function chapel(): Builder[] {
  const c = CHAPEL;
  const y = landHeight(c.x, c.z);
  const nave = placed(c.x, y, c.z, c.rot);
  nave.trimHex = '#4e7395';
  gabled(nave, c.w, c.d, c.wallH, c.roofH, CHAPEL_WALL, CHAPEL_WALL, '#f7f2e8', '#c9694c');
  // the bell tower at the left end: white, an open arch for the bell, a little tiled pyramid
  const t = c.tower;
  const tower = new Builder(new THREE.Matrix4().makeTranslation(t.du, 0, 0), new THREE.Matrix3());
  tower.walls(t.half, t.half, -0.3, t.height, [TOWER, TOWER, TOWER, TOWER], '#f7f2e8');
  const tip: [number, number, number] = [0, t.height + 0.42, 0];
  const s = t.half + 0.05;
  const corners: [number, number][] = [[-s, s], [s, s], [s, -s], [-s, -s]];
  const run = Math.hypot(s, 0.42);
  for (let i = 0; i < 4; i++) {
    const a = corners[i], q = corners[(i + 1) % 4];
    tower.face([[a[0], t.height, a[1]], [q[0], t.height, q[1]], tip], [[0, run], [2 * s, run], [s, 0]], ROOF, 2 * s, '#c9694c');
  }
  append(nave, tower);
  return [nave];
}

/** Append a builder made in another's local frame. */
function append(target: Builder, local: Builder): void {
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < local.pos.length; i += 3) {
    v.set(local.pos[i], local.pos[i + 1], local.pos[i + 2]).applyMatrix4(target.m);
    n.set(local.nrm[i], local.nrm[i + 1], local.nrm[i + 2]).applyMatrix3(target.nm).normalize();
    target.pos.push(v.x, v.y, v.z);
    target.nrm.push(n.x, n.y, n.z);
  }
  target.col.push(...local.col);
  target.trim.push(...local.trim);
  target.paint.push(...local.paint);
}

/** The quay's stone face, standing in the water along its arc, with a dressed coping on top. */
function quayWall(): Builder {
  const b = placed(0, 0, 0, 0);
  let run = 0;
  for (let i = 0; i < QUAY_LINE.length - 1; i++) {
    const [x0, z0] = QUAY_LINE[i], [x1, z1] = QUAY_LINE[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    b.face([[x0, -0.5, z0 + 0.005], [x1, -0.5, z1 + 0.005], [x1, QUAY_Y, z1 + 0.005], [x0, QUAY_Y, z0 + 0.005]], [[run, -0.5], [run + len, -0.5], [run + len, QUAY_Y], [run, QUAY_Y]], QUAYWALL, 1, '#cbbfa9');
    run += len;
  }
  return b;
}

/** The breakwater: a long mound of big squared blocks, sloped sides, a flat top. */
function breakwater(): Builder {
  const b = placed(0, 0, 0, 0);
  const half = BREAKWATER_HALF, foot = half + 0.28, top = BREAKWATER_Y;
  let run = 0;
  for (let i = 0; i < BREAKWATER.length - 1; i++) {
    const [x0, z0] = BREAKWATER[i], [x1, z1] = BREAKWATER[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const nx = -(z1 - z0) / len, nz = (x1 - x0) / len;
    const P = (x: number, z: number, off: number, y: number): [number, number, number] => [x + nx * off, y, z + nz * off];
    // top
    b.face([P(x0, z0, half, top), P(x1, z1, half, top), P(x1, z1, -half, top), P(x0, z0, -half, top)], [[run, 0], [run + len, 0], [run + len, 1], [run, 1]], BREAK, 0, '#d8ccb6');
    // the two sloping sides
    for (const s of [1, -1]) {
      b.face([P(x0, z0, s * foot, -0.45), P(x1, z1, s * foot, -0.45), P(x1, z1, s * half, top), P(x0, z0, s * half, top)], [[run, -0.45], [run + len, -0.45], [run + len, top], [run, top]], BREAK, 1, '#c7bba5');
    }
    run += len;
  }
  // a rounded end at the tip
  const [tx, tz] = BREAKWATER[BREAKWATER.length - 1];
  for (let k = 0; k < 10; k++) {
    const a0 = (k / 10) * Math.PI * 2, a1 = ((k + 1) / 10) * Math.PI * 2;
    b.face([[tx + Math.cos(a0) * foot, -0.45, tz + Math.sin(a0) * foot], [tx + Math.cos(a1) * foot, -0.45, tz + Math.sin(a1) * foot], [tx + Math.cos(a1) * half, top, tz + Math.sin(a1) * half], [tx + Math.cos(a0) * half, top, tz + Math.sin(a0) * half]], [[k * 0.2, -0.45], [k * 0.2 + 0.2, -0.45], [k * 0.2 + 0.2, top], [k * 0.2, top]], BREAK, 1, '#c7bba5');
    b.face([[tx, top, tz], [tx + Math.cos(a1) * half, top, tz + Math.sin(a1) * half], [tx + Math.cos(a0) * half, top, tz + Math.sin(a0) * half]], [[0, 0], [1, 0], [0, 1]], BREAK, 0, '#d8ccb6');
  }
  return b;
}

/** A lathe of quads round the y axis: rings of [radius, y]. */
function lathe(b: Builder, rings: [number, number][], kind: number, hex: string, segs = 24): void {
  for (let r = 0; r < rings.length - 1; r++) {
    const [ra, ya] = rings[r], [rb, yb] = rings[r + 1];
    const slope = Math.atan2(ra - rb, yb - ya);
    for (let k = 0; k < segs; k++) {
      const a0 = (k / segs) * Math.PI * 2, a1 = ((k + 1) / segs) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const n0 = new THREE.Vector3(c0 * Math.cos(slope), Math.sin(slope), s0 * Math.cos(slope));
      const n1 = new THREE.Vector3(c1 * Math.cos(slope), Math.sin(slope), s1 * Math.cos(slope));
      const u0 = (k / segs) * 2 * Math.PI * 0.3, u1 = ((k + 1) / segs) * 2 * Math.PI * 0.3;
      b.smoothQuad(
        [new THREE.Vector3(c0 * ra, ya, s0 * ra), new THREE.Vector3(c0 * rb, yb, s0 * rb), new THREE.Vector3(c1 * rb, yb, s1 * rb), new THREE.Vector3(c1 * ra, ya, s1 * ra)],
        [n0, n0, n1, n1],
        [[u0, ya], [u0, yb], [u1, yb], [u1, ya]],
        kind, 1, hex,
      );
    }
  }
}

function lighthouse(): Builder {
  const L = LIGHTHOUSE;
  const b = placed(L.x, landHeight(L.x, L.z) - 0.05, L.z, 0);
  const H = L.height;
  // tapering white tower (the red band is painted), the gallery, the lantern and its cap
  lathe(b, [[L.radius * 1.12, -0.25], [L.radius, 0.05], [L.radius * 0.78, H]], LIGHT, '#f6f2ea');
  lathe(b, [[L.radius * 1.12, H], [L.radius * 1.12, H + 0.06], [L.radius * 0.6, H + 0.06]], TRIM, '#3d4a5c');
  lathe(b, [[L.radius * 0.6, H + 0.06], [L.radius * 0.6, H + 0.34]], LANTERN, '#ffe7a8', 16);
  lathe(b, [[L.radius * 0.7, H + 0.34], [L.radius * 0.7, H + 0.38], [0.02, H + 0.6]], TRIM, '#c8473d', 16);
  return b;
}

const vertex = /* glsl */ `
attribute vec3 color;
attribute vec3 aTrim;
attribute vec4 aPaint;
varying vec3 vColor;
varying vec3 vTrim;
varying vec4 vPaint;
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vColor = color;
  vTrim = aTrim;
  vPaint = aPaint;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
uniform float uLamp;
varying vec3 vColor;
varying vec3 vTrim;
varying vec4 vPaint;
varying vec3 vWorld;
varying vec3 vNormalW;

vec3 srgbC(vec3 c) { return pow(c, vec3(2.2)); }
float box(vec2 p, vec2 c, vec2 h) { vec2 d = abs(p - c) - h; return max(d.x, d.y); }
float fillAA(float d, float w) { return 1.0 - smoothstep(-w, w, d); }

// a tall window: dark glass, a cream frame, and a pair of painted shutters either side
vec3 window(vec3 c, vec2 p, vec2 centre, vec2 h, float aa, bool shutters) {
  vec3 frame = srgbC(vec3(0.97, 0.95, 0.9));
  vec3 g = mix(srgbC(vec3(0.3, 0.38, 0.5)), srgbC(vec3(0.58, 0.68, 0.8)), smoothstep(centre.y - h.y, centre.y + h.y, p.y) * 0.6);
  g = mix(g, g * 1.45, smoothstep(0.018, 0.0, abs(p.x - centre.x - (p.y - centre.y) * 0.8 + h.x * 0.3)) * 0.5);
  if (shutters) {
    float sh = fillAA(box(vec2(abs(p.x - centre.x), p.y), vec2(h.x * 1.75 + 0.012, centre.y), vec2(h.x * 0.65, h.y + 0.01)), aa);
    vec3 trim = vTrim * (0.92 + 0.12 * step(0.5, fract(p.y * 55.0)));
    c = mix(c, trim, sh);
  }
  c = mix(c, frame, fillAA(box(p, centre, h + 0.014), aa));
  c = mix(c, g, fillAA(box(p, centre, h), aa));
  c = mix(c, frame, fillAA(box(p, centre, h), aa) * fillAA(abs(p.x - centre.x) - 0.006, aa));
  c *= 1.0 - 0.28 * fillAA(box(p, centre - vec2(0.0, h.y + 0.025), vec2(h.x + 0.03, 0.007)), aa);
  return c;
}

vec3 paintWall(vec3 c, float kind, vec2 p, float len, float aa) {
  float n = max(1.0, floor(len / 0.34));
  float spacing = len / n;
  float i = floor(p.x / spacing);
  float cx = (i + 0.5) * spacing;
  bool front = kind > 1.5 && kind < 2.5;
  bool gable = kind > 2.5;
  float doorI = floor(n * 0.5 + hash12(floor(vWorld.xz * 0.5)) * 0.99 - 0.5);
  // storeys of windows up the wall
  for (int k = 0; k < 4; k++) {
    float y = 0.53 + float(k) * 0.32;
    if (gable && mod(i + float(k), 2.0) > 0.5) continue;
    c = window(c, p, vec2(cx, y), vec2(0.055, 0.075), aa, !gable);
  }
  if (front && abs(i - doorI) < 0.5) {
    vec3 door = vTrim * 0.85;
    float dd = box(p, vec2(cx, 0.13), vec2(0.06, 0.14));
    c = mix(c, srgbC(vec3(0.95, 0.93, 0.88)), fillAA(dd - 0.014, aa));
    c = mix(c, door * (0.9 + 0.2 * smoothstep(0.0, 0.25, p.y)), fillAA(dd, aa));
  } else if (!gable) {
    c = window(c, p, vec2(cx, 0.2), vec2(0.055, 0.07), aa, front);
  }
  return c;
}

void main() {
  float kind = vPaint.x;
  vec2 p = vPaint.yz;
  float len = vPaint.w;
  float aa = max(fwidth(p.x), fwidth(p.y)) * 0.8 + 0.001;
  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;
  vec3 c = vColor;
  float grain = vnoise(p * 24.0 + kind * 7.0) * 0.6 + vnoise(p * 70.0) * 0.4;
  float emissive = 0.0;

  if (kind < 3.5) {
    // plaster: a soft pastel wash, darker and a little damp at the foot
    c *= 0.95 + 0.08 * grain;
    c *= 0.82 + 0.18 * smoothstep(-0.05, 0.2, p.y);
    c = paintWall(c, kind, p, len, aa);
  } else if (kind < 4.5) {
    // pantiles: courses down the slope, staggered breaks, a few darker tiles
    float course = p.y / 0.065;
    float row = floor(course);
    float tile = floor(p.x / 0.075 + row * 0.5);
    c *= 0.88 + 0.18 * hash12(vec2(tile, row));
    c *= 1.0 - 0.24 * smoothstep(0.72, 1.0, fract(course));
    c *= 1.0 - 0.14 * smoothstep(0.08, 0.0, abs(fract(p.x / 0.075 + row * 0.5) - 0.5) - 0.42);
    c *= 1.0 - 0.18 * smoothstep(0.05, 0.0, p.y);
    c = mix(c, srgbC(vec3(0.72, 0.72, 0.5)), step(0.985, hash12(floor(p * 18.0) + kind)) * 0.45);
  } else if (kind < 5.5) {
    c *= 0.94 + 0.08 * grain;
  } else if (kind < 6.5) {
    // the bell tower: an arched opening with a bronze bell in it
    c *= 0.95 + 0.06 * grain;
    vec2 q = p - vec2(len * 0.5, 1.28);
    float arch = q.y < 0.0 ? box(q, vec2(0.0, -0.08), vec2(0.075, 0.08)) : length(q) - 0.075;
    c = mix(c, srgbC(vec3(0.3, 0.3, 0.36)), fillAA(arch, aa));
    c = mix(c, srgbC(vec3(0.72, 0.55, 0.3)), fillAA(length((q - vec2(0.0, -0.03)) * vec2(1.0, 1.3)) - 0.04, aa));
  } else if (kind < 7.5) {
    // the café awning: red and cream stripes
    c = mix(c, vTrim, step(0.5, fract(p.x / 0.09)));
    c *= 0.93 + 0.1 * grain;
  } else if (kind < 8.5) {
    // the chapel: whitewash and tall arched windows
    c *= 0.95 + 0.06 * grain;
    float n = max(1.0, floor(len / 0.42));
    float sp = len / n;
    float cx = (floor(p.x / sp) + 0.5) * sp;
    vec2 q = p - vec2(cx, 0.4);
    float arch = q.y < 0.12 ? box(q, vec2(0.0), vec2(0.055, 0.14)) : length(q - vec2(0.0, 0.12)) - 0.055;
    c = mix(c, srgbC(vec3(0.85, 0.82, 0.76)), fillAA(arch - 0.016, aa));
    c = mix(c, srgbC(vec3(0.36, 0.46, 0.62)), fillAA(arch, aa));
  } else if (kind < 9.5) {
    // the quay wall: big dressed blocks, darker and green with weed where the water laps
    float row = floor((p.y + 0.5) / 0.12);
    float block = hash12(vec2(floor(p.x / 0.3 + row * 0.5), row));
    c *= 0.88 + 0.16 * block;
    c *= 1.0 - 0.2 * smoothstep(0.86, 1.0, fract((p.y + 0.5) / 0.12));
    c *= 1.0 - 0.15 * smoothstep(0.08, 0.0, abs(fract(p.x / 0.3 + row * 0.5) - 0.5) - 0.46);
    c = mix(c, srgbC(vec3(0.42, 0.5, 0.36)), smoothstep(0.08, -0.02, p.y + (vnoise(p * vec2(6.0, 2.0)) - 0.5) * 0.06) * 0.7);
    c = mix(c, srgbC(vec3(0.9, 0.86, 0.78)), smoothstep(${(QUAY_Y - 0.05).toFixed(3)}, ${QUAY_Y.toFixed(3)}, p.y) * 0.7);
  } else if (kind < 10.5) {
    // breakwater blocks: big, squared and irregular, wet and weedy low down
    vec2 q = len > 0.5 ? vec2(p.x, p.y) * vec2(2.4, 5.0) : vec2(p.x * 2.4, p.y * 2.0);
    float row = floor(q.y);
    vec2 cell = vec2(floor(q.x + row * 0.5 + vnoise(q * 0.7) * 0.3), row);
    c *= 0.84 + 0.22 * hash12(cell);
    vec2 fr = fract(vec2(q.x + row * 0.5 + vnoise(q * 0.7) * 0.3, q.y));
    c *= 1.0 - 0.24 * smoothstep(0.08, 0.0, min(min(fr.x, 1.0 - fr.x), min(fr.y, 1.0 - fr.y)));
    if (len > 0.5) c = mix(c, srgbC(vec3(0.4, 0.48, 0.36)), smoothstep(0.06, -0.06, p.y + (vnoise(p * 5.0) - 0.5) * 0.08) * 0.75);
  } else if (kind < 11.5) {
    // the lighthouse: white with one red band, a little door and a slit window
    c *= 0.95 + 0.06 * grain;
    float band = step(1.05, p.y) * step(p.y, 1.42);
    c = mix(c, srgbC(vec3(0.8, 0.26, 0.22)), band);
    c = mix(c, srgbC(vec3(0.3, 0.4, 0.52)), fillAA(box(p, vec2(0.22, 0.12), vec2(0.045, 0.12)), aa));
    c = mix(c, srgbC(vec3(0.3, 0.36, 0.46)), fillAA(box(p, vec2(0.6, 1.7), vec2(0.022, 0.06)), aa));
  } else {
    // the lantern: glazing bars, and the lamp flashing as the beam turns toward us
    float bars = fillAA(abs(fract(p.x / 0.09) - 0.5) - 0.44, aa);
    c = mix(c, srgbC(vec3(0.24, 0.28, 0.34)), 1.0 - bars);
    emissive = uLamp * bars;
  }

  float sunVis = castLight(vWorld, 0.02);
  vec3 col = paintLight(c, N, sunVis, 1.0, 0.12);
  float lift = smoothstep(0.55, 0.9, dot(N, uSunDir)) * sunVis;
  col = mix(col, col * vec3(1.08, 1.07, 0.97), lift * 0.6);
  float shade = 1.0 - smoothstep(-0.2, 0.5, dot(N, uSunDir));
  col = mix(col, col * vec3(0.86, 0.87, 1.02), shade * 0.4);
  // warm light bounced up off the water and the quay
  col += c * vec3(0.04, 0.045, 0.04) * (1.0 - abs(N.y)) * (1.0 - smoothstep(0.0, 0.6, vWorld.y));
  col += srgbC(vec3(1.0, 0.9, 0.6)) * emissive * 1.2;
  gl_FragColor = vec4(col, 1.0);
}
`;

export interface Buildings {
  mesh: THREE.Mesh;
  /** 0..1: how brightly the lamp shows (strongest as the beam swings toward the viewer). */
  setLamp(v: number): void;
}

export function createBuildings(world: WorldUniforms): Buildings {
  const geo = geometryFrom([...HOUSES.map(house), ...chapel(), quayWall(), breakwater(), lighthouse()]);
  const material = new THREE.ShaderMaterial({ uniforms: { ...world, uLamp: { value: 0 } }, vertexShader: vertex, fragmentShader: fragment, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'buildings';
  mesh.layers.enable(SHADOW_LAYER);
  return { mesh, setLamp: (v) => (material.uniforms.uLamp.value = v) };
}
