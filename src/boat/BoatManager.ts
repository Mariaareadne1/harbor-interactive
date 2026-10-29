import * as THREE from 'three';
import { Boat } from './Boat';
import { intentOf, type BoatRecord, type HarborDoc } from '../state/document';
import { Sailing, type SimBoat } from '../sail/sim';
import type { Water, WaterBoat } from '../scene/water';
import type { WorldUniforms } from '../scene/world';

/**
 * Keeps the live boats in step with the document and the simulation. New
 * records are painted in (or simply appear, when loaded); removed ones sail
 * off and fade; a changed command re-plans the voyage; a changed name is
 * repainted. Each frame it steps the sailing, poses every boat and hands
 * the water what it needs for wakes and ripples.
 */
export class BoatManager {
  readonly group = new THREE.Group();
  readonly sailing: Sailing;
  private readonly live = new Map<string, { boat: Boat; record: BoatRecord }>();
  /** Boats sailing off, with the simulated boat they follow out. */
  private readonly leaving = new Map<Boat, SimBoat | undefined>();
  /** Ids drawn just now: these are painted in rather than appearing. */
  readonly fresh = new Set<string>();
  selectedId: string | null = null;
  hoverId: string | null = null;
  private readonly waterBoats: WaterBoat[] = [];

  constructor(private readonly world: WorldUniforms, private readonly water: Water, private readonly calm: boolean) {
    this.group.name = 'boats';
    this.sailing = new Sailing(calm);
  }

  get(id: string): Boat | undefined {
    return this.live.get(id)?.boat;
  }

  sim(id: string): SimBoat | undefined {
    return this.sailing.get(id);
  }

  ids(): string[] {
    return [...this.live.keys()];
  }

  sync(doc: HarborDoc, now: number): void {
    const ids = new Set(doc.boats.map((b) => b.id));
    for (const [id, { boat }] of this.live) {
      if (ids.has(id)) continue;
      this.live.delete(id);
      if (this.fresh.has(id) || !boat.loaded) {
        // undone straight after drawing: just lift it off the water
        this.fresh.delete(id);
        this.sailing.drop(id);
        this.group.remove(boat.root);
        boat.dispose();
        continue;
      }
      this.sailing.remove(id);
      boat.leave(now);
      this.leaving.set(boat, this.sailing.get(id));
    }
    for (const rec of doc.boats) {
      const cur = this.live.get(rec.id);
      if (!cur) {
        const fresh = this.fresh.has(rec.id);
        // a boat brought back by undo while it is still sailing off: let it go and make a new one
        if (this.sailing.get(rec.id)) this.sailing.drop(rec.id);
        const boat = new Boat(rec, this.world, this.calm, now, fresh);
        this.sailing.add({ id: rec.id, length: boat.shape.length, beam: boat.shape.beam, seed: rec.seed, x: rec.x, z: rec.z, heading: rec.heading, intent: intentOf(rec), launch: fresh });
        this.live.set(rec.id, { boat, record: rec });
        this.group.add(boat.root);
        if (fresh) this.water.ring(rec.x, rec.z, now, 0.8);
        continue;
      }
      if (rec.mode !== cur.record.mode || rec.target?.[0] !== cur.record.target?.[0] || rec.target?.[1] !== cur.record.target?.[1]) {
        this.sailing.setIntent(rec.id, intentOf(rec));
      }
      if (rec.name !== cur.record.name) cur.boat.setName(rec.name);
      cur.record = rec;
    }
  }

  update(now: number, dt: number): void {
    this.sailing.advance(dt);
    for (const r of this.sailing.takeRings()) this.water.ring(r.x, r.z, now, r.strength);
    this.waterBoats.length = 0;
    for (const [id, { boat }] of this.live) {
      const s = this.sailing.get(id);
      if (!s) continue;
      boat.highlight = id === this.selectedId ? 1 : id === this.hoverId ? 0.45 : 0;
      boat.update(s, now);
      if (this.fresh.has(id) && boat.revealProgress(now) >= 1) this.fresh.delete(id);
      this.waterBoats.push({ x: s.x, z: s.z, heading: s.heading, speed: s.speed, length: boat.length, beam: boat.shape.beam, turn: s.turn, presence: boat.loaded ? 1 : 0 });
    }
    for (const [boat, sim] of this.leaving) {
      const s = sim ?? boat.sim;
      if (s) boat.update(s, now);
      if (s && this.waterBoats.length < 10) this.waterBoats.push({ x: s.x, z: s.z, heading: s.heading, speed: s.speed, length: boat.length * boat.root.scale.x, beam: boat.shape.beam, turn: s.turn, presence: boat.root.scale.x });
      if (boat.gone(now)) {
        this.group.remove(boat.root);
        boat.dispose();
        this.leaving.delete(boat);
        if (sim && this.sailing.boats.includes(sim)) this.sailing.boats.splice(this.sailing.boats.indexOf(sim), 1);
      }
    }
    this.water.update(now, this.waterBoats);
  }

  /** Live positions to save: where each boat is now, without an undo step. */
  positions(): Map<string, { x: number; z: number; heading: number }> {
    const out = new Map<string, { x: number; z: number; heading: number }>();
    for (const id of this.live.keys()) {
      const s = this.sailing.get(id);
      if (s) out.set(id, { x: s.x, z: s.z, heading: s.heading });
    }
    return out;
  }

  /** The boat under a screen point: nearest hull within a generous radius. */
  pick(clientX: number, clientY: number, camera: THREE.Camera, rect: DOMRect, pixelsPerMeter: (p: THREE.Vector3) => number): string | null {
    let best: string | null = null;
    let bestD = Infinity;
    const v = new THREE.Vector3();
    for (const [id, { boat }] of this.live) {
      // aim between the hull and the sail, where the eye sees "the boat"
      v.copy(boat.position).setY(boat.position.y + boat.length * 0.25).project(camera);
      if (v.z > 1) continue;
      const sx = rect.left + ((v.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - v.y) / 2) * rect.height;
      const d = Math.hypot(sx - clientX, sy - clientY);
      const r = Math.max(22, pixelsPerMeter(boat.position) * boat.length * 0.6);
      if (d < r && d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  dispose(): void {
    for (const { boat } of this.live.values()) boat.dispose();
    for (const b of this.leaving.keys()) b.dispose();
    this.live.clear();
    this.leaving.clear();
  }
}
