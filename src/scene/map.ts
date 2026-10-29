import * as THREE from 'three';
import { TILE, breakwaterDistance, calmness, coastDistance, ROCKS, QUAY } from './harbour';

/**
 * The harbour's shape, sampled once on the CPU into a small texture so the
 * painted land and water shaders read exactly the same coast the boats steer
 * by (no GLSL twin to drift out of step):
 *   r: signed distance to the coast (m, negative on land)
 *   g: distance to the breakwater's edge or a rock (m, negative on it)
 *   b: calmness (1 in the harbour, 0 at sea)
 *   a: beach (1 on and off the sandy beach)
 */

export const MAP_DENSITY = 12;
export const MAP_PAD = 0.8;

export interface HarbourMap {
  texture: THREE.DataTexture;
  /** minX, minZ, sizeX, sizeZ — world rectangle the texture covers. */
  bounds: THREE.Vector4;
}

export function createHarbourMap(): HarbourMap {
  const minX = -TILE.halfX - MAP_PAD, minZ = -TILE.halfZ - MAP_PAD;
  const sizeX = 2 * (TILE.halfX + MAP_PAD), sizeZ = 2 * (TILE.halfZ + MAP_PAD);
  const w = Math.round(sizeX * MAP_DENSITY), h = Math.round(sizeZ * MAP_DENSITY);
  const data = new Uint16Array(w * h * 4);
  const half = THREE.DataUtils.toHalfFloat;
  for (let j = 0; j < h; j++) {
    const z = minZ + ((j + 0.5) / h) * sizeZ;
    for (let i = 0; i < w; i++) {
      const x = minX + ((i + 0.5) / w) * sizeX;
      const c = coastDistance(x, z);
      let b = breakwaterDistance(x, z);
      for (const r of ROCKS) b = Math.min(b, Math.hypot(x - r.x, z - r.z) - r.r);
      const beach = x < QUAY.x0 + 0.2 && z > -3.6 && z < 2.6 ? 1 : 0;
      const k = (j * w + i) * 4;
      data[k] = half(Math.max(-8, Math.min(8, c)));
      data[k + 1] = half(Math.max(-8, Math.min(8, b)));
      data[k + 2] = half(calmness(x, z));
      data[k + 3] = half(beach);
    }
  }
  const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return { texture, bounds: new THREE.Vector4(minX, minZ, sizeX, sizeZ) };
}

export const MAP_GLSL = /* glsl */ `
uniform sampler2D uMap;
uniform vec4 uMapBounds;
vec4 harbourMap(vec2 xz) { return texture2D(uMap, (xz - uMapBounds.xy) / uMapBounds.zw); }
`;
