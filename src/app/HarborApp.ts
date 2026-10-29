import * as THREE from 'three';
import type { Engine } from '../engine/Engine';
import type { Store, Selection } from '../state/store';
import {
  addBoat, emptyDoc, findBoat, MAX_BOATS, newBoatId, newSeed, removeBoat, updateBoat, type BoatRecord, type HarborDoc,
} from '../state/document';
import { saveDoc } from '../state/persistence';
import type { Pt } from '../interaction/stroke';
import { screenToWater, worldToScreen } from '../interaction/terrainRay';
import { HarbourScene } from '../scene/HarbourScene';
import { BoatManager } from '../boat/BoatManager';
import { shapeFromLoop, type HullError, type V2 } from '../boat/hull';
import { cleanName, nameFor, rollName } from '../boat/names';
import { SEA_MARGIN, edgeDistance, isWater, obstacleDistance, obstacleGradient } from '../scene/harbour';

/**
 * Application commands. UI and pointer input call these; they turn intent
 * into document edits — drawing a boat, sending it somewhere, sailing out,
 * coming home, renaming, removing — all undoable. Where each boat is right
 * now is saved too, but quietly, without an undo step.
 */

export type StrokeResult = { ok: true; id: string } | { ok: false; message: string };

const MESSAGES: Record<HullError | 'land' | 'full', string> = {
  open: 'Close the loop — draw the whole outline of a boat.',
  small: 'Draw a bigger boat.',
  thin: 'Give it a little more width.',
  land: 'Draw your boat on the water.',
  full: 'Ten boats is a full harbour — the oldest one has sailed off.',
};

export class HarborApp {
  readonly harbour: HarbourScene;
  readonly boats: BoatManager;
  private saveTimer = 0;
  private liveTimer = 0;
  private readonly unsub: (() => void)[] = [];
  private warnedFull = false;
  hoverId: string | null = null;

  constructor(readonly engine: Engine, readonly store: Store) {
    this.harbour = new HarbourScene(engine);
    this.boats = new BoatManager(engine.world, this.harbour.water, engine.reducedMotion);
    engine.scene.add(this.boats.group);
  }

  start(): void {
    let prevDoc: HarborDoc | null = null;
    const onChange = () => {
      const doc = this.store.doc;
      if (doc === prevDoc) return;
      prevDoc = doc;
      this.boats.sync(doc, this.engine.elapsed);
      window.clearTimeout(this.saveTimer);
      this.saveTimer = window.setTimeout(() => this.persist(), 250);
    };
    this.unsub.push(this.store.subscribe(onChange));
    onChange();
    this.unsub.push(
      this.engine.onFrame((dt, t) => {
        this.boats.selectedId = this.store.get().selection?.id ?? null;
        this.boats.hoverId = this.hoverId;
        this.boats.update(t, dt);
      }),
    );
    // where the boats are is saved every few seconds and when the page goes away
    this.liveTimer = window.setInterval(() => this.persist(), 3000);
    window.addEventListener('pagehide', this.persist);
    this.store.set({ loading: false });
  }

  /** The document with every boat where it is right now. */
  liveDoc(doc: HarborDoc = this.store.doc): HarborDoc {
    const at = this.boats.positions();
    return {
      ...doc,
      boats: doc.boats.map((b) => {
        const p = at.get(b.id);
        return p ? { ...b, x: round(p.x), z: round(p.z), heading: round(p.heading) } : b;
      }),
    };
  }

  readonly persist = (): void => {
    saveDoc(this.liveDoc());
  };

  /** Commit an edit, first noting where everything is (so undo puts boats back near where they were). */
  private commit(edit: (doc: HarborDoc) => HarborDoc, patch: Parameters<Store['commit']>[1] = {}): void {
    const live = this.liveDoc();
    this.store.amend(live);
    this.store.commit(edit(live), patch);
  }

  get rect(): DOMRect {
    return this.engine.canvas.getBoundingClientRect();
  }

  // --- drawing ---------------------------------------------------------------

  waterAt(clientX: number, clientY: number): THREE.Vector3 | null {
    return screenToWater(this.engine.camera, this.rect, clientX, clientY);
  }

  canDrawAt(clientX: number, clientY: number): boolean {
    const p = this.waterAt(clientX, clientY);
    return !!p && isWater(p.x, p.z) && edgeDistance(p.x, p.z) > 0.4;
  }

  /** A drawn loop on the water becomes a boat; anything else explains itself. */
  createFromStroke(points: readonly Pt[]): StrokeResult {
    const loop: V2[] = [];
    let wet = 0;
    for (const p of points) {
      const w = this.waterAt(p.x, p.y);
      if (!w) continue;
      loop.push([w.x, w.z]);
      if (isWater(w.x, w.z) || obstacleDistance(w.x, w.z) > -0.25) wet++;
    }
    if (loop.length < 8) return { ok: false, message: MESSAGES.land };
    const r = shapeFromLoop(loop);
    if (!r.ok) return { ok: false, message: MESSAGES[r.reason] };
    if (wet / loop.length < 0.75) return { ok: false, message: MESSAGES.land };
    const hull = r.hull;
    // nudge it off a quay or rock it slightly overlaps; refuse if it is really on land
    let [cx, cz] = hull.center;
    const fits = (x: number, z: number) => {
      const c = Math.cos(hull.heading), s = Math.sin(hull.heading);
      return Math.min(
        obstacleDistance(x, z) - hull.beam * 0.45,
        obstacleDistance(x + c * hull.length * 0.47, z + s * hull.length * 0.47) - 0.03,
        obstacleDistance(x - c * hull.length * 0.45, z - s * hull.length * 0.45) - hull.beam * 0.25,
        edgeDistance(x, z) - SEA_MARGIN * 0.4,
      );
    };
    for (let i = 0; i < 40 && fits(cx, cz) < 0; i++) {
      const [gx, gz] = obstacleGradient(cx, cz);
      const toward = edgeDistance(cx, cz) - SEA_MARGIN * 0.4 < 0 ? [-Math.sign(cx) * (Math.abs(cx) > 10 ? 1 : 0), -Math.sign(cz) * (Math.abs(cz) > 6.5 ? 1 : 0)] : [gx, gz];
      cx += toward[0] * 0.04;
      cz += toward[1] * 0.04;
    }
    if (fits(cx, cz) < 0 || Math.hypot(cx - hull.center[0], cz - hull.center[1]) > 1.2) return { ok: false, message: MESSAGES.land };

    if (this.store.doc.boats.length >= MAX_BOATS && !this.warnedFull) {
      this.warnedFull = true;
      this.store.toast(MESSAGES.full);
    }
    const seed = newSeed();
    const record: BoatRecord = {
      id: newBoatId(), outline: hull.outline, seed, name: nameFor(seed),
      x: round(cx), z: round(cz), heading: round(hull.heading), mode: 'free', target: null,
    };
    this.boats.fresh.add(record.id);
    this.commit((d) => addBoat(d, record), { hasDrawn: true });
    return { ok: true, id: record.id };
  }

  // --- selection ------------------------------------------------------------

  pickAt(clientX: number, clientY: number): Selection {
    const id = this.boats.pick(clientX, clientY, this.engine.camera, this.rect, (p) => this.engine.pixelsPerMeterAt(p));
    return id ? { kind: 'boat', id } : null;
  }

  select(sel: Selection): void {
    if (this.store.get().selection?.id !== sel?.id) this.store.set({ selection: sel });
  }

  private target(id?: string): string | null {
    const t = id ?? this.store.get().selection?.id ?? null;
    return t && findBoat(this.store.doc, t) ? t : null;
  }

  /** Where a boat is on screen (for the course line). */
  boatOnScreen(id: string): { x: number; y: number } | null {
    const b = this.boats.get(id);
    if (!b) return null;
    const s = worldToScreen(this.engine.camera, this.rect, b.position);
    return { x: s.x - this.rect.left, y: s.y - this.rect.top };
  }

  // --- commands ---------------------------------------------------------------

  sailOut(id?: string): void {
    const t = this.target(id);
    if (t) this.commit((d) => updateBoat(d, t, { mode: 'out', target: null }));
  }

  comeHome(id?: string): void {
    const t = this.target(id);
    if (t) this.commit((d) => updateBoat(d, t, { mode: 'home', target: null }));
  }

  remove(id?: string): void {
    const t = this.target(id);
    if (!t) return;
    this.commit((d) => removeBoat(d, t), { selection: null });
  }

  rename(id: string, raw: string): void {
    const name = cleanName(raw);
    const b = findBoat(this.store.doc, id);
    if (!b || !name || name === b.name) return;
    this.commit((d) => updateBoat(d, id, { name }));
  }

  rollName(id: string): void {
    const b = findBoat(this.store.doc, id);
    if (b) this.rename(id, rollName(b.name));
  }

  /** Can a boat be sent to this screen point? Returns the water point, or null. */
  courseTarget(clientX: number, clientY: number): THREE.Vector3 | null {
    const p = this.waterAt(clientX, clientY);
    if (!p || obstacleDistance(p.x, p.z) < 0.45 || edgeDistance(p.x, p.z) < SEA_MARGIN * 0.8) return null;
    return p;
  }

  /** Send a boat to a point on the water: it plans its tacks and waits there. */
  sendTo(id: string, clientX: number, clientY: number): boolean {
    const p = this.courseTarget(clientX, clientY);
    if (!p || !findBoat(this.store.doc, id)) return false;
    this.commit((d) => updateBoat(d, id, { mode: 'goto', target: [round(p.x), round(p.z)] }));
    return true;
  }

  // --- the whole harbour ------------------------------------------------------------------

  reset(): void {
    if (this.store.doc.boats.length === 0) return;
    this.commit(() => emptyDoc(), { selection: null });
    this.store.toast('The harbour is clear. Undo brings the boats back.');
  }

  loadDoc(doc: HarborDoc): void {
    this.store.commit(doc, { selection: null });
  }

  undo(): void {
    this.store.amend(this.liveDoc());
    this.store.undo();
  }

  redo(): void {
    this.store.redo();
  }

  dispose(): void {
    window.clearTimeout(this.saveTimer);
    window.clearInterval(this.liveTimer);
    window.removeEventListener('pagehide', this.persist);
    this.persist();
    for (const u of this.unsub) u();
    this.boats.dispose();
    this.harbour.dispose();
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000;
