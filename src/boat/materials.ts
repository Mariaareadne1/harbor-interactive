import * as THREE from 'three';
import { LIGHTING_GLSL, NOISE_GLSL, WORLD_UNIFORMS_GLSL } from '../scene/shaderChunks';
import type { WorldUniforms } from '../scene/world';

/**
 * The boat's painted materials. One shader, three uses:
 *   HULL — a pastel wash with a contrasting stripe and rim, a honey deck
 *          with a cockpit and a thwart, painted in with MEADOW's brush reveal;
 *   SAIL — cloth with seams, an optional stripe, light glowing through it;
 *   SPAR — the mast, boom and tiller.
 * All of them dissolve into dry-brush specks when a boat sails away.
 */

export interface BoatLook {
  hull: string;
  stripe: string;
  sail: string;
  sailStripe: string | null;
  deck: string;
}

const HULLS: [string, string][] = [
  ['#f2e8d3', '#c4613f'], // cream, red
  ['#bdd6eb', '#2f5480'], // pale blue, navy
  ['#f0c3bd', '#a5463e'], // rose, deep red
  ['#c4e3cf', '#3c7860'], // mint, green
];
const SAILS = ['#f5eedd', '#c96a45', '#5d88b6', '#f2d27c'];

/** A small painted set: the seed picks hull, stripe and sail colours. */
export function lookFor(seed: number): BoatLook {
  const h = HULLS[seed % HULLS.length];
  const sail = SAILS[Math.floor(seed / 4) % SAILS.length];
  const striped = Math.floor(seed / 16) % 2 === 1;
  return { hull: h[0], stripe: h[1], sail, sailStripe: striped ? (sail === SAILS[0] ? h[1] : '#f5eedd') : null, deck: '#d8b07a' };
}

export interface BoatUniforms {
  [name: string]: THREE.IUniform;
  uReveal: THREE.IUniform<number>;
  uFade: THREE.IUniform<number>;
  uHighlight: THREE.IUniform<number>;
  uSeed: THREE.IUniform<number>;
}

const vertex = /* glsl */ `
#ifdef HULL
attribute vec4 aHull;
varying vec4 vHull;
#endif
#ifdef SAIL
attribute vec2 aSail;
varying vec2 vSail;
#endif
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vLocal;
void main() {
#ifdef HULL
  vHull = aHull;
#endif
#ifdef SAIL
  vSail = aSail;
#endif
  vLocal = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
uniform vec3 uColor;
uniform vec3 uStripe;
uniform vec3 uDeck;
uniform float uStriped;
uniform float uReveal;
uniform float uFade;
uniform float uHighlight;
uniform float uSeed;
#ifdef HULL
varying vec4 vHull;
#endif
#ifdef SAIL
varying vec2 vSail;
#endif
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vLocal;

float fillAA(float d, float w) { return 1.0 - smoothstep(-w, w, d); }

void main() {
  // sailing away: the paint breaks up into dry-brush specks
  if (uFade < 0.999 && hash13(floor(vWorld * 60.0)) > uFade) discard;
  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 c = uColor;
  float wet = 0.0;
  float soft = 0.15;
  float glow = 0.0;

#ifdef HULL
  float part = vHull.x;
  float u = vHull.y;      // -1 stern .. 1 bow
  float across = vHull.z; // -1 port .. 1 starboard
  float h = vHull.w;      // 0 keel .. 1 gunwale
  // MEADOW's painted reveal: brush strokes sweep from stern to bow, their ends ragged
  if (uReveal < 0.999) {
    float stroke = vnoise(vec2(h * 9.0, across * 3.0) + uSeed) * 0.6 + vnoise(vec2(u * 6.0, h * 24.0)) * 0.4;
    float gap = uReveal * 1.3 - ((u * 0.5 + 0.5) * 0.85 + stroke * 0.4);
    if (gap < 0.0) discard;
    wet = 1.0 - smoothstep(0.0, 0.14, gap);
  }
  float aa = fwidth(h) + 0.002;
  if (part < 0.5) {
    // topsides: the pastel wash, a stripe under the rim, antifouling below the waterline
    c = uColor * (0.94 + 0.1 * vnoise(vec2(u * 14.0, h * 30.0) + uSeed));
    c = mix(c, uStripe, fillAA(abs(h - 0.86) - 0.035, aa) * (0.4 + 0.6 * step(0.5, uStriped)));
    c = mix(c, pow(vec3(0.72, 0.35, 0.28), vec3(2.2)), 1.0 - smoothstep(0.42, 0.45, h));
  } else if (part < 1.5) {
    c = uStripe * (0.92 + 0.12 * vnoise(vec2(u * 30.0, 0.0)));
  } else if (part < 2.5) {
    // the deck: honey planks fore and aft, a darker cockpit and one thwart to sit on
    float plank = fract(across * 3.2 + 0.5);
    c = uDeck * (0.9 + 0.14 * hash12(vec2(floor(across * 3.2 + 0.5), floor(u * 3.0 + across * 2.0))));
    c *= 1.0 - 0.18 * smoothstep(0.08, 0.0, min(plank, 1.0 - plank));
    float cockpit = smoothstep(0.78, 0.7, abs(across)) * smoothstep(-0.82, -0.72, u) * smoothstep(0.32, 0.22, u);
    c = mix(c, c * vec3(0.72, 0.7, 0.74), cockpit);
    float thwart = fillAA(abs(u - 0.0) - 0.06, 0.01) * smoothstep(0.95, 0.85, abs(across));
    c = mix(c, uDeck * 1.12, thwart);
  } else {
    c = uColor * 0.95;
    c = mix(c, uStripe, fillAA(abs(h - 0.86) - 0.035, aa));
  }
#endif

#ifdef SAIL
  // cloth: seams parallel to the foot, a stripe if it has one, a bolt rope round the edge
  float s = vSail.x, t = vSail.y;
  c = uColor * (0.95 + 0.07 * vnoise(vec2(s * 20.0, t * 40.0) + uSeed));
  c *= 1.0 - 0.07 * smoothstep(0.012, 0.0, abs(fract(t * 7.0) - 0.5) - 0.48);
  if (uStriped > 0.5) c = mix(c, uStripe, fillAA(abs(t - 0.3) - 0.07, 0.01));
  c *= 1.0 - 0.1 * smoothstep(0.035, 0.0, min(s, t));
  soft = 0.35;
  // thin cloth: the sun glows through it when lit from behind
  glow = max(0.0, dot(-N, uSunDir)) * 0.35;
#endif

#ifdef SPAR
  c = uColor * (0.92 + 0.12 * vnoise(vLocal.xy * 40.0));
#endif

  float sunVis = castLight(vWorld, 0.015);
  vec3 col = paintLight(c, N, sunVis, 1.0, soft);
  col += c * uSunColor * glow * sunVis;
  float lift = smoothstep(0.55, 0.9, dot(N, uSunDir)) * sunVis;
  col = mix(col, col * vec3(1.08, 1.07, 0.97), lift * 0.5);
  float shade = 1.0 - smoothstep(-0.2, 0.5, dot(N, uSunDir));
  col = mix(col, col * vec3(0.86, 0.88, 1.03), shade * 0.4);
  // the light bounced up off the water warms the topsides from below
  col += c * vec3(0.03, 0.05, 0.05) * max(0.0, -N.y + 0.3);
  // the wet edge of fresh paint
  col = mix(col, col * 1.18 + vec3(0.02), wet * 0.6);
  // selection: a soft blue rim light
  col += vec3(0.12, 0.3, 0.75) * uHighlight * pow(1.0 - max(dot(N, V), 0.0), 2.2) * 0.7;
  gl_FragColor = vec4(col, 1.0);
}
`;

export function boatMaterial(world: WorldUniforms, kind: 'HULL' | 'SAIL' | 'SPAR', o: { color: string; stripe?: string | null; deck?: string; seed: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...world,
      uColor: { value: new THREE.Color(o.color) },
      uStripe: { value: new THREE.Color(o.stripe ?? o.color) },
      uDeck: { value: new THREE.Color(o.deck ?? '#d8b07a') },
      uStriped: { value: o.stripe ? 1 : 0 },
      uReveal: { value: 1 },
      uFade: { value: 1 },
      uHighlight: { value: 0 },
      uSeed: { value: (o.seed % 97) * 0.731 },
    },
    defines: { [kind]: 1 },
    vertexShader: vertex,
    fragmentShader: fragment,
    side: THREE.DoubleSide,
  });
}
