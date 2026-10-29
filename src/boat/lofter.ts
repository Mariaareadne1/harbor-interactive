import * as THREE from 'three';
import { loftHull, type LoftData } from './loft';
import type { V2 } from './hull';

/**
 * Hands hull outlines to a worker and turns its arrays into geometry. If
 * workers are unavailable (or the worker fails), the loft runs here instead —
 * it is a few milliseconds of arithmetic.
 */

let worker: Worker | null = null;
let failed = false;
let nextId = 1;
const pending = new Map<number, { resolve: (d: LoftData) => void; outline: readonly V2[] }>();

function getWorker(): Worker | null {
  if (failed || typeof Worker === 'undefined') return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('./hull.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<{ id: number; data?: LoftData; error?: string }>) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        p.resolve(e.data.data ?? loftHull(p.outline));
      };
      worker.onerror = () => {
        // fall back for everything in flight and everything after
        failed = true;
        for (const [id, p] of pending) {
          pending.delete(id);
          p.resolve(loftHull(p.outline));
        }
      };
    } catch {
      failed = true;
      return null;
    }
  }
  return worker;
}

export function loft(outline: readonly V2[]): Promise<LoftData> {
  const w = getWorker();
  if (!w) return Promise.resolve(loftHull(outline));
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, { resolve, outline });
    w.postMessage({ id, outline: outline.map((p) => [p[0], p[1]]) });
  });
}

export function loftSync(outline: readonly V2[]): LoftData {
  return loftHull(outline);
}

export function hullGeometry(d: LoftData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(d.normal, 3));
  g.setAttribute('aHull', new THREE.BufferAttribute(d.paint, 4));
  g.setIndex(new THREE.BufferAttribute(d.index, 1));
  g.computeBoundingSphere();
  return g;
}
