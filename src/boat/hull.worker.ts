/// <reference lib="webworker" />
import { loftHull } from './loft';
import type { V2 } from './hull';

/** Lofts hulls off the main thread (like MEADOW's wool), so drawing never stutters. */
self.onmessage = (e: MessageEvent<{ id: number; outline: V2[] }>) => {
  const { id, outline } = e.data;
  try {
    const d = loftHull(outline);
    (self as unknown as Worker).postMessage({ id, data: d }, [d.position.buffer, d.normal.buffer, d.paint.buffer, d.index.buffer]);
  } catch (error) {
    (self as unknown as Worker).postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
