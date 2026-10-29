import * as THREE from 'three';
import { LIGHTHOUSE, MOORINGS, TILE, WIND_TO } from './harbour';
import { MAP_GLSL, MAP_PAD, type HarbourMap } from './map';
import { LIGHTING_GLSL, NOISE_GLSL, WORLD_UNIFORMS_GLSL } from './shaderChunks';
import type { WaterReflection } from './reflection';
import type { WorldUniforms } from './world';

/**
 * The painted water. Nothing is simulated: it is laid in like gouache —
 * calm turquoise washes in the harbour, a deeper blue with soft white crests
 * out at sea, a pale sandy shelf off the beach, long dry-brush streaks that
 * drift with the breeze, sun glints, and the town's reflection broken up into
 * horizontal ripples. Boats leave a short white wake and a faint V; bumps and
 * launches leave ripple rings; the lighthouse beam sweeps the water by the point.
 */

export const MAX_BOATS = 10;
export const MAX_RINGS = 8;

const f = (n: number) => n.toFixed(4);
const moorings = MOORINGS.map(([x, z]) => `vec2(${f(x)}, ${f(z)})`).join(', ');

const vertex = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${MAP_GLSL}
uniform sampler2D uReflect;
uniform mat4 uReflectMatrix;
uniform float uReflectOn;
uniform vec4 uBoatA[${MAX_BOATS}]; // x, z, heading, speed
uniform vec4 uBoatB[${MAX_BOATS}]; // length, beam, turn rate, presence
uniform vec4 uRings[${MAX_RINGS}]; // x, z, birth time, strength
uniform float uCalm;
uniform float uBeam; // lighthouse beam angle
varying vec3 vWorld;

const vec2 WIND = vec2(${f(WIND_TO[0])}, ${f(WIND_TO[1])});
const vec2 LIGHT = vec2(${f(LIGHTHOUSE.x)}, ${f(LIGHTHOUSE.z)});
const vec2 BUOYS[${MOORINGS.length}] = vec2[](${moorings});

vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }

float speck(vec2 p, float scale, float density, float radius, out float id) {
  vec2 c = p * scale;
  vec2 cell = floor(c);
  id = hash12(cell + 0.37);
  vec2 off = vec2(hash12(cell + 3.1), hash12(cell + 7.7)) * 0.5 + 0.25;
  float on = step(1.0 - density, hash12(cell));
  return on * smoothstep(radius, radius * 0.6, length(fract(c) - off));
}
vec2 cells(vec2 p, float t) {
  vec2 n = floor(p), fr = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = vec2(hash12(n + g), hash12(n + g + 19.7));
      o = 0.5 + 0.42 * sin(t + 6.2831 * o);
      vec2 r = g + o - fr;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  return vec2(sqrt(d1), sqrt(d2) - sqrt(d1));
}
float lace(vec2 p, float t, float thick) {
  p += vec2(vnoise(p * 0.7 + t * 0.1), vnoise(p * 0.7 + 5.3 - t * 0.1)) * 0.9;
  return 1.0 - smoothstep(thick * 0.35, thick, cells(p, t).y);
}
float patches(vec2 p, float cover) {
  float n = vnoise(p) * 0.65 + vnoise(p * 2.3 + 7.1) * 0.35;
  return smoothstep(1.0 - cover, 1.0 - cover + 0.22, n);
}
float paintEdge(vec2 xz) {
  vec2 q = abs(xz) - vec2(${f(TILE.halfX)}, ${f(TILE.halfZ)}) + 1.0;
  float box = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 1.0;
  float rough = (vnoise(xz * 1.1) - 0.5) * 0.5 + (vnoise(xz * 4.0) - 0.5) * 0.24;
  return -box + rough;
}

/** Foam and ripples a boat leaves behind it: a short white wake and a faint V. */
void boatWake(vec2 xz, vec4 a, vec4 b, inout float foam, inout float ripple) {
  if (b.w < 0.01) return;
  vec2 rel = xz - a.xy;
  float L = b.x;
  if (dot(rel, rel) > (L * 5.0) * (L * 5.0)) return;
  vec2 fwd = vec2(cos(a.z), sin(a.z));
  float along = dot(rel, fwd);
  float side = dot(rel, vec2(-fwd.y, fwd.x));
  float speed = a.w;
  float back = -along - L * 0.42;
  if (back < -L * 0.2) return;
  // the past track curves away when the boat is turning
  float kappa = b.z / max(speed, 0.15);
  side -= 0.5 * clamp(kappa, -2.0, 2.0) * max(back, 0.0) * max(back, 0.0);
  float sp = smoothstep(0.04, 0.5, speed);
  // white water off the stern
  float wakeLen = L * (0.5 + 1.1 * sp);
  float width = b.y * 0.22 + max(back, 0.0) * 0.12;
  float white = smoothstep(width, width * 0.3, abs(side)) * smoothstep(-L * 0.15, 0.05, back) * (1.0 - smoothstep(0.0, wakeLen, back));
  foam = max(foam, white * sp * (0.45 + 0.55 * lace(vec2(back * 5.0, side * 9.0) + a.xy, uTime * 1.6, 0.35)) * b.w);
  // the V: two arms spreading at about 19 degrees, feathered with small wavelets
  float vb = -along + L * 0.35;
  if (vb > 0.0) {
    float arm = vb * 0.354 + b.y * 0.25;
    float line = exp(-pow((abs(side) - arm) / (0.035 + vb * 0.012), 2.0));
    float fade = 1.0 - smoothstep(L * 0.6, L * 3.8, vb);
    float wavelets = 0.55 + 0.45 * sin(vb * 26.0 - uTime * 5.0);
    ripple = max(ripple, line * fade * wavelets * sp * b.w);
  }
}

void main() {
  vec2 xz = vWorld.xz;
  float edge = paintEdge(xz);
  // the open sea fades slowly into the paper
  float cover = smoothstep(-0.05, 1.1, edge);
  if (hash12(floor(xz * 26.0)) > cover * 1.08) discard;
  vec4 m = harbourMap(xz);
  if (m.r < -0.3) discard;

  float t = uTime;
  float calm = m.b;
  float beach = m.a;
  float shore = min(m.r, m.g);
  vec3 V = normalize(cameraPosition - vWorld);
  // the wind's frame: along it and across it
  vec2 w = vec2(dot(xz, WIND), dot(xz, vec2(-WIND.y, WIND.x)));
  float drift = t * mix(0.16, 0.07, calm) * uCalm;

  // ---- colour: washes from the shallows into the deep ----
  float wash = fbm2lite(xz * 0.16 + vec2(t * 0.008, 0.0));
  float depth = shore + (wash - 0.5) * 0.9;
  vec3 hShallow = srgb(vec3(0.56, 0.84, 0.79));
  vec3 hMid = srgb(vec3(0.37, 0.72, 0.75));
  vec3 sMid = srgb(vec3(0.27, 0.57, 0.71));
  vec3 sDeep = srgb(vec3(0.17, 0.41, 0.62));
  vec3 harbourCol = mix(hShallow, hMid, smoothstep(0.1, 1.8, depth));
  vec3 seaCol = mix(sMid, sDeep, smoothstep(0.6, 4.5, depth));
  vec3 albedo = mix(seaCol, harbourCol, calm);
  // the pale sandy shelf off the beach, sand showing through
  albedo = mix(albedo, srgb(vec3(0.74, 0.85, 0.72)), beach * smoothstep(1.5, 0.1, m.r) * 0.75);
  albedo = mix(albedo, srgb(vec3(0.86, 0.84, 0.68)), beach * smoothstep(0.35, 0.0, m.r) * 0.5);
  // long dry-brush streaks drifting with the breeze, darker strokes in deep water
  float stroke = vnoise(vec2(w.x * 0.45 - drift * 2.0, w.y * 5.5)) * 0.6 + vnoise(vec2(w.x * 1.3 - drift * 3.0, w.y * 15.0)) * 0.4;
  albedo *= 0.93 + 0.12 * stroke;
  float dark = smoothstep(0.62, 0.8, vnoise(vec2(w.x * 0.35 - drift, w.y * 2.6) + 11.0)) * smoothstep(0.8, 2.5, depth);
  albedo *= 1.0 - 0.13 * dark * (1.0 - 0.5 * calm);

  float sunVis = castLight(vWorld, 0.02);
  vec3 col = paintLight(albedo, vec3(0.0, 1.0, 0.0), sunVis, 1.0, 0.2);

  // ---- reflections of the town, the lighthouse and the boats, broken by ripples ----
  if (uReflectOn > 0.5) {
    float band = floor(xz.y * 9.0 + vnoise(xz * vec2(0.6, 3.0)) * 2.0);
    float wob = (hash12(vec2(band, floor(t * 1.5 * uCalm))) - 0.5) * 0.04 + sin(xz.x * 3.0 + band * 1.7 + t * 1.3 * uCalm) * 0.035;
    vec2 jitter = vec2(wob * mix(1.8, 1.0, calm), (vnoise(xz * 2.0 + t * 0.2) - 0.5) * 0.05);
    // a painter's cheat: at this steep a view the true mirror image hides under the quay,
    // so the reflection is laid a little further out on the water, where it can be seen
    // (only near the shore: a boat's reflection stays right under it)
    float lay = 1.05 * smoothstep(2.6, 0.9, m.r) * calm;
    vec4 rp = uReflectMatrix * vec4(xz.x + jitter.x, 0.0, xz.y + jitter.y - lay, 1.0);
    vec4 refl = texture2DProj(uReflect, rp);
    float strokes = 0.6 + 0.4 * smoothstep(0.25, 0.6, vnoise(vec2(xz.x * 1.2, band * 0.7)));
    float k = refl.a * mix(0.3, 0.55, calm) * strokes;
    vec3 tinted = mix(refl.rgb, albedo, 0.25) * vec3(0.88, 0.95, 0.98);
    col = mix(col, tinted, k);
  }

  // ---- foam: the shore's edge, crests at sea, wakes and rings ----
  float foam = 0.0, ripple = 0.0;
  // a lacy line where the water meets sand, rock and the breakwater
  float shoreLine = smoothstep(0.16, 0.0, shore) * (0.45 + 0.55 * lace(xz * 3.2 + vec2(t * 0.05, 0.0), t * 0.6, 0.3));
  foam = max(foam, shoreLine * mix(0.85, 0.5, calm));
  // a darker wet line along the foot of the quay wall
  col *= 1.0 - 0.12 * smoothstep(0.12, 0.0, m.r) * (1.0 - beach) * calm;
  // soft white crests out at sea, travelling with the wind
  if (calm < 0.95) {
    // each crest a short soft dab of white across the wind, broken at its ends
    vec2 cq = vec2(w.x * 1.1 - drift * 3.0, w.y * 0.55);
    vec2 cid = floor(cq);
    vec2 cf = fract(cq) - 0.5;
    float on = step(0.7, hash12(cid + 4.0));
    vec2 co = (vec2(hash12(cid + 1.0), hash12(cid + 2.0)) - 0.5) * 0.4;
    vec2 dq = (cf - co) * vec2(3.6, 2.4);
    dq.x += dq.y * dq.y * 0.35; // curled like a brush flick
    float dab = smoothstep(0.5, 0.2, length(dq));
    float life = 0.5 + 0.5 * sin(t * 0.8 * uCalm + hash12(cid) * 6.3);
    float broken = smoothstep(0.25, 0.6, vnoise(xz * 7.0 + cid));
    foam = max(foam, on * dab * life * broken * (1.0 - calm) * 0.7 * smoothstep(0.5, 1.5, shore));
  }
  for (int i = 0; i < ${MAX_BOATS}; i++) boatWake(xz, uBoatA[i], uBoatB[i], foam, ripple);
  for (int i = 0; i < ${MAX_RINGS}; i++) {
    vec4 r = uRings[i];
    float age = t - r.z;
    if (r.w <= 0.0 || age < 0.0 || age > 2.6) continue;
    float rad = 0.12 + age * 0.55;
    float d = length(xz - r.xy);
    ripple = max(ripple, exp(-pow((d - rad) / 0.035, 2.0)) * (1.0 - age / 2.6) * r.w);
    ripple = max(ripple, exp(-pow((d - rad * 0.6) / 0.03, 2.0)) * (1.0 - age / 2.6) * r.w * 0.5);
  }
  // a little ring of ripples round each mooring buoy as it bobs
  for (int i = 0; i < ${MOORINGS.length}; i++) {
    float d = length(xz - BUOYS[i]);
    if (d > 0.5) continue;
    float rr = 0.1 + fract(t * 0.35 + float(i) * 0.37) * 0.35;
    ripple = max(ripple, exp(-pow((d - rr) / 0.02, 2.0)) * (1.0 - fract(t * 0.35 + float(i) * 0.37)) * 0.6);
  }
  vec3 white = uSunColor * srgb(vec3(0.97, 0.98, 0.96));
  col = mix(col, white, clamp(foam, 0.0, 0.92));
  col = mix(col, col * 1.12 + white * 0.12, clamp(ripple, 0.0, 1.0) * 0.8);

  // ---- light: glints, the lighthouse beam, the sky's sheen ----
  float gid;
  float glit = speck(xz + vec2(t * 0.06, 0.0) * uCalm, 7.0, mix(0.1, 0.05, calm), 0.17, gid) * step(0.62, fract(gid * 13.0 + t * 0.4 * uCalm));
  float streak = smoothstep(0.78, 0.92, vnoise(vec2(w.x * 0.32 - drift * 1.5, w.y * 2.4))) * 0.16;
  col += uSunColor * (glit * 0.55 + streak * 0.3) * sunVis;
  vec2 lr = xz - LIGHT;
  vec2 bd = vec2(cos(uBeam), sin(uBeam));
  float along = dot(lr, bd);
  if (along > 0.0) {
    float off = abs(dot(lr, vec2(-bd.y, bd.x))) / along;
    float beam = smoothstep(0.2, 0.02, off) * smoothstep(0.4, 1.4, along) * (1.0 - smoothstep(2.5, 8.0, along));
    col += srgb(vec3(1.0, 0.94, 0.75)) * beam * 0.16 * (0.75 + 0.25 * vnoise(xz * 3.0 + t));
  }
  col = mix(col, srgb(vec3(0.88, 0.94, 0.96)), pow(1.0 - max(V.y, 0.0), 3.0) * 0.2);
  // where the paint thins at the edge, the paper shows through
  col = mix(uPaper, col, 0.3 + 0.7 * smoothstep(0.0, 1.4, edge));
  gl_FragColor = vec4(col, 1.0);
}
`;

export interface WaterBoat {
  x: number;
  z: number;
  heading: number;
  speed: number;
  length: number;
  beam: number;
  turn: number;
  presence: number;
}

export class Water {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly rings: THREE.Vector4[] = Array.from({ length: MAX_RINGS }, () => new THREE.Vector4(0, 0, -99, 0));
  private ringNext = 0;

  constructor(world: WorldUniforms, map: HarbourMap, private readonly reflection: WaterReflection, calm: boolean) {
    const w = 2 * (TILE.halfX + MAP_PAD), h = 2 * (TILE.halfZ + MAP_PAD);
    const geo = new THREE.PlaneGeometry(w, h, 1, 1).rotateX(-Math.PI / 2);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...world,
        uMap: { value: map.texture },
        uMapBounds: { value: map.bounds },
        uReflect: { value: reflection.target.texture },
        uReflectMatrix: { value: reflection.matrix },
        uReflectOn: { value: 1 },
        uBoatA: { value: Array.from({ length: MAX_BOATS }, () => new THREE.Vector4()) },
        uBoatB: { value: Array.from({ length: MAX_BOATS }, () => new THREE.Vector4()) },
        uRings: { value: this.rings },
        uCalm: { value: calm ? 0.35 : 1 },
        uBeam: { value: 0 },
      },
      vertexShader: vertex,
      fragmentShader: fragment,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'water';
    reflection.hidden.add(this.mesh);
  }

  /** A ring of ripples spreading from a point (a launch, a bump). */
  ring(x: number, z: number, time: number, strength = 1): void {
    this.rings[this.ringNext].set(x, z, time, strength);
    this.ringNext = (this.ringNext + 1) % MAX_RINGS;
  }

  update(time: number, boats: readonly WaterBoat[]): void {
    const u = this.material.uniforms;
    const a = u.uBoatA.value as THREE.Vector4[];
    const b = u.uBoatB.value as THREE.Vector4[];
    for (let i = 0; i < MAX_BOATS; i++) {
      const boat = boats[i];
      if (!boat) {
        b[i].w = 0;
        continue;
      }
      a[i].set(boat.x, boat.z, boat.heading, boat.speed);
      b[i].set(boat.length, boat.beam, boat.turn, boat.presence);
    }
    // the lamp turns once every twelve seconds
    u.uBeam.value = time * ((2 * Math.PI) / 12);
    u.uReflectOn.value = this.reflection.enabled ? 1 : 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
