import * as THREE from 'three';
import { landHeight } from '../scene/harbour';

type HeightField = (x: number, z: number) => number;

/**
 * Exact screen-to-surface intersection against an analytic height field (the
 * harbour's land and water): march the view ray until it
 * dips under the surface, then bisect. Null when the ray misses.
 */
export function raycastHeight(
  height: HeightField,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  maxDistance = 420,
  target = new THREE.Vector3(),
): THREE.Vector3 | null {
  const dir = direction;
  const above = (t: number) => origin.y + dir.y * t - height(origin.x + dir.x * t, origin.z + dir.z * t);
  let prev = 0;
  if (above(prev) < 0) return null;
  let t = 0.05;
  while (t < maxDistance) {
    if (above(t) < 0) {
      let lo = prev;
      let hi = t;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (above(mid) < 0) hi = mid;
        else lo = mid;
      }
      return target.copy(origin).addScaledVector(dir, hi);
    }
    prev = t;
    t += 0.04 + t * 0.012;
  }
  return null;
}

const ndc = new THREE.Vector2();
const ray = new THREE.Raycaster();

function setRay(camera: THREE.PerspectiveCamera, rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): THREE.Ray {
  ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.ray;
}

/** Client (CSS pixel) coordinates -> the water's surface (y = 0), wherever the ray meets it. */
export function screenToWater(
  camera: THREE.PerspectiveCamera,
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
  target = new THREE.Vector3(),
): THREE.Vector3 | null {
  const r = setRay(camera, rect, clientX, clientY);
  if (r.direction.y >= -1e-4) return null;
  const t = -r.origin.y / r.direction.y;
  return target.copy(r.origin).addScaledVector(r.direction, t);
}

/** Client (CSS pixel) coordinates -> whatever is on top: the land, or the water over the seabed. */
export function screenToSurface(
  camera: THREE.PerspectiveCamera,
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
  target = new THREE.Vector3(),
): THREE.Vector3 | null {
  const r = setRay(camera, rect, clientX, clientY);
  return raycastHeight((x, z) => Math.max(0, landHeight(x, z)), r.origin, r.direction, 420, target);
}

/** World point -> client coordinates (CSS pixels). */
export function worldToScreen(
  camera: THREE.PerspectiveCamera,
  rect: { left: number; top: number; width: number; height: number },
  p: THREE.Vector3,
): { x: number; y: number; behind: boolean } {
  const v = p.clone().project(camera);
  return {
    x: rect.left + ((v.x + 1) / 2) * rect.width,
    y: rect.top + ((1 - v.y) / 2) * rect.height,
    behind: v.z > 1,
  };
}
