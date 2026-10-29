import * as THREE from 'three';
import { shapeFromOutline, stations, type HullShape, type V2 } from './hull';
import { draftOf, freeboardOf, sheer, type LoftData } from './loft';
import { hullGeometry, loft } from './lofter';
import { boatMaterial, lookFor, type BoatLook } from './materials';
import { SHADOW_LAYER } from '../engine/shadows';
import { WIND_TO, swellAt, windStrength } from '../scene/harbour';
import { LAUNCH_TIME, type SimBoat } from '../sail/sim';
import type { WorldUniforms } from '../scene/world';

/**
 * One little sailing dinghy: a hull lofted from the drawn outline, a mast,
 * a boom and one triangular sail that fills and flaps with the wind, a tiller,
 * a pennant at the masthead and its name painted on the stern. It reads its
 * place, heel and sail trim from the simulation every frame, and adds the bob
 * and pitch of the swell. A freshly drawn boat is painted in — hull first,
 * then the mast rises, then the sail unfurls and fills with a little snap.
 */

const SAIL_S = 10, SAIL_T = 12;
/** Reveal timeline (s after drawing). */
const T_HULL = 0.95, T_MAST = [0.85, 1.4] as const, T_HOIST = [1.35, 1.95] as const, T_FILL = 1.95;

const smooth = (a: number, b: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

export interface BoatRecordLike {
  readonly id: string;
  readonly outline: readonly V2[];
  readonly seed: number;
  readonly name: string;
}

export class Boat {
  readonly root = new THREE.Group();
  private readonly heel = new THREE.Group();
  readonly shape: HullShape;
  readonly look: BoatLook;
  private hull: THREE.Mesh | null = null;
  private readonly hullMat: THREE.ShaderMaterial;
  private readonly sailMat: THREE.ShaderMaterial;
  private readonly sparMat: THREE.ShaderMaterial;
  private readonly mast: THREE.Mesh;
  private readonly boomPivot = new THREE.Group();
  private readonly sail: THREE.Mesh;
  private readonly sailPos: Float32Array;
  private readonly pennant: THREE.Mesh;
  private readonly nameTag: THREE.Mesh;
  private nameText = '';
  private readonly mastH: number;
  private readonly boomY: number;
  private readonly boomLen: number;
  private readonly mastU: number;
  readonly freeboard: number;
  /** When it was drawn (engine time), or -Infinity if it was simply there. */
  readonly born: number;
  private leftAt: number | null = null;
  private shadowsOn = false;
  highlight = 0;
  /** Last known state, for labels and the water. */
  sim: SimBoat | null = null;
  private ready = false;
  private disposed = false;

  constructor(record: BoatRecordLike, world: WorldUniforms, private readonly calm: boolean, now: number, fresh: boolean) {
    this.shape = shapeFromOutline(record.outline);
    this.look = lookFor(record.seed);
    this.born = fresh ? now : -Infinity;
    const L = this.shape.length;
    this.freeboard = freeboardOf(L);
    this.root.name = `boat ${record.id}`;
    this.root.add(this.heel);

    this.hullMat = boatMaterial(world, 'HULL', { color: this.look.hull, stripe: this.look.stripe, deck: this.look.deck, seed: record.seed });
    this.sailMat = boatMaterial(world, 'SAIL', { color: this.look.sail, stripe: this.look.sailStripe, seed: record.seed });
    this.sparMat = boatMaterial(world, 'SPAR', { color: '#efe4cf', seed: record.seed });

    // the rig, sized to the hull: a stubby mast on a tubby boat, a tall one on a long one
    const st = stations(record.outline);
    const u0 = st[0].u, u1 = st[st.length - 1].u;
    this.mastU = u0 + (u1 - u0) * 0.62;
    const deckAtMast = sheer(L, (2 * this.mastU) / L) - 0.03;
    this.mastH = 0.62 + 0.55 * L;
    this.boomY = deckAtMast + 0.1 + 0.03 * L;
    this.boomLen = (this.mastU - u0) * 0.9;
    this.mast = new THREE.Mesh(new THREE.CylinderGeometry(0.011 + 0.004 * L, 0.016 + 0.005 * L, this.mastH, 8).translate(0, this.mastH / 2, 0), this.sparMat);
    this.mast.position.set(this.mastU, deckAtMast, 0);
    this.heel.add(this.mast);

    this.boomPivot.position.set(this.mastU, this.boomY, 0);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, this.boomLen, 6).rotateZ(Math.PI / 2).translate(-this.boomLen / 2, 0, 0), this.sparMat);
    this.boomPivot.add(boom);
    this.heel.add(this.boomPivot);

    // the sail: a grid over the triangle (s along the foot, t up the luff), reshaped every frame
    const sailGeo = new THREE.BufferGeometry();
    this.sailPos = new Float32Array((SAIL_S + 1) * (SAIL_T + 1) * 3);
    const uv = new Float32Array((SAIL_S + 1) * (SAIL_T + 1) * 2);
    const index: number[] = [];
    for (let j = 0; j <= SAIL_T; j++) {
      for (let i = 0; i <= SAIL_S; i++) {
        const k = j * (SAIL_S + 1) + i;
        uv[k * 2] = i / SAIL_S;
        uv[k * 2 + 1] = j / SAIL_T;
        if (i < SAIL_S && j < SAIL_T) index.push(k, k + 1, k + SAIL_S + 1, k + 1, k + SAIL_S + 2, k + SAIL_S + 1);
      }
    }
    sailGeo.setAttribute('position', new THREE.BufferAttribute(this.sailPos, 3).setUsage(THREE.DynamicDrawUsage));
    sailGeo.setAttribute('aSail', new THREE.BufferAttribute(uv, 2));
    sailGeo.setIndex(index);
    sailGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(this.mastU, this.mastH / 2, 0), this.mastH);
    this.sail = new THREE.Mesh(sailGeo, this.sailMat);
    this.heel.add(this.sail);

    // tiller, and a little pennant at the masthead
    const tiller = new THREE.Mesh(new THREE.BoxGeometry(L * 0.22, 0.012, 0.014).translate(L * 0.11, 0, 0), this.sparMat);
    tiller.position.set(u0 + 0.02, sheer(L, -1) + 0.025, 0);
    tiller.rotation.z = 0.12;
    this.heel.add(tiller);
    const pen = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.035, 0), new THREE.Vector3(0, -0.035, 0), new THREE.Vector3(0.16, 0, 0)]);
    pen.setAttribute('aSail', new THREE.BufferAttribute(new Float32Array([0, 0.5, 0, 0.5, 1, 0.5]), 2));
    pen.computeVertexNormals();
    this.pennant = new THREE.Mesh(pen, boatMaterial(world, 'SAIL', { color: this.look.stripe, seed: record.seed }));
    this.pennant.position.set(this.mastU, deckAtMast + this.mastH, 0);
    this.heel.add(this.pennant);

    // the name, painted across the stern deck
    this.nameTag = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.25).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
    this.nameTag.position.set(u0 + 0.13 + 0.04 * L, sheer(L, -0.8) - 0.028, 0);
    this.nameTag.rotation.y = -Math.PI / 2;
    this.nameTag.renderOrder = 3;
    this.heel.add(this.nameTag);
    this.setName(record.name);

    this.revealRig(fresh ? 0 : 99);
    void loft(record.outline).then((d) => this.attachHull(d));
  }

  private attachHull(d: LoftData): void {
    if (this.disposed) return;
    this.hull = new THREE.Mesh(hullGeometry(d), this.hullMat);
    this.hull.name = 'hull';
    this.heel.add(this.hull);
    this.ready = true;
  }

  /** Has the hull arrived from the worker? */
  get loaded(): boolean {
    return this.ready;
  }

  get position(): THREE.Vector3 {
    return this.root.position;
  }

  get length(): number {
    return this.shape.length;
  }

  setName(name: string): void {
    if (name === this.nameText) return;
    this.nameText = name;
    const mat = this.nameTag.material as THREE.MeshBasicMaterial;
    mat.map?.dispose();
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.font = 'italic 600 74px "Fraunces Variable", Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = this.look.stripe;
      ctx.fillText(name, 256, 66, 490);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    mat.map = tex;
    mat.color.set('#c9c3ba'); // sits in the light like the paint round it
    mat.needsUpdate = true;
    // across the stern: as wide as the deck there allows
    const st = stations(this.shape.outline);
    const w = Math.max(0.1, (st[3].port + st[3].starboard) * 0.85);
    this.nameTag.scale.set(w, 1, w);
  }

  /** The painted-in sequence, by seconds since drawing. */
  private revealRig(age: number): void {
    const mast = smooth(T_MAST[0], T_MAST[1], age);
    this.mast.scale.y = Math.max(1e-3, mast);
    this.mast.visible = mast > 0.001;
    this.boomPivot.visible = mast > 0.6;
    this.boomPivot.scale.setScalar(Math.max(1e-3, smooth(0.6, 1, mast)));
    this.pennant.visible = mast > 0.95;
    this.nameTag.visible = age > T_HULL;
    this.hullMat.uniforms.uReveal.value = Math.min(1, age / T_HULL);
  }

  /** Reshape the sail: hoisted to `hoist`, bellied by `fill`, flapping by `luff`. */
  private shapeSail(boom: number, hoist: number, fill: number, luff: number, time: number): void {
    const top = this.mastH * 0.94 - (this.boomY - this.mast.position.y);
    const B = this.boomLen;
    const c = Math.cos(boom), s = Math.sin(boom);
    // aft along the boom, and the sail's normal, in boat space
    const ax = -c, az = s;
    const nx = s, nz = c;
    const side = boom >= 0 ? 1 : -1;
    const W = windStrength(time);
    for (let j = 0; j <= SAIL_T; j++) {
      const t = j / SAIL_T;
      for (let i = 0; i <= SAIL_S; i++) {
        const sv = i / SAIL_S;
        const k = (j * (SAIL_S + 1) + i) * 3;
        const y = this.boomY + t * top * hoist;
        const along = sv * (1 - t) * B;
        const belly = side * fill * 0.13 * B * Math.sin(Math.PI * sv) * Math.pow(1 - t, 0.6) * (0.85 + 0.15 * W);
        const flap = luff * 0.045 * B * Math.sin(Math.PI * sv) * Math.sin(time * 13 - sv * 7 + t * 3) * (1 - t * 0.5);
        // a furled sail lies along the boom until it is hoisted
        const off = belly + flap * (this.calm ? 0.4 : 1);
        this.sailPos[k] = this.mastU + ax * along + nx * off;
        this.sailPos[k + 1] = y;
        this.sailPos[k + 2] = az * along + nz * off;
      }
    }
    const attr = this.sail.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
    this.sail.geometry.computeVertexNormals();
  }

  /** Begin sailing away (removed): it shrinks toward the horizon and fades. */
  leave(now: number): void {
    if (this.leftAt === null) this.leftAt = now;
  }

  /** Fully faded out? */
  gone(now: number): boolean {
    return this.leftAt !== null && now - this.leftAt > 7.5;
  }

  update(sim: SimBoat, now: number): void {
    this.sim = sim;
    const age = now - this.born;
    this.revealRig(age);
    if (!this.shadowsOn && age > T_FILL + 0.2 && this.ready) {
      // shadows only once the boat is fully there
      this.shadowsOn = true;
      this.root.traverse((o) => o !== this.nameTag && o.layers.enable(SHADOW_LAYER));
    }

    // the swell: heave, pitch and a little roll, plus a bob after a bump
    const L = this.shape.length;
    const sw = swellAt(sim.x, sim.z, now);
    const fx = Math.cos(sim.heading), fz = Math.sin(sim.heading);
    const slopeAlong = sw.dx * fx + sw.dz * fz;
    const slopeAcross = -sw.dx * fz + sw.dz * fx;
    const motion = this.calm ? 0.35 : 1;
    const bump = Math.max(0, 1 - (now - sim.bumped) / 1.2);
    const bob = Math.sin((now - sim.bumped) * 11) * bump * 0.03;
    // sitting a touch lower when it is fresh off the brush, then settling
    const settle = Math.max(0, 1 - smooth(0, 0.9, age)) * 0.04;
    this.root.position.set(sim.x, sw.h * motion + bob * motion - draftOf(L) * 0.05 - settle, sim.z);
    const pitch = Math.atan(slopeAlong) * 0.8 * motion + Math.min(0.06, sim.speed * 0.04);
    const roll = sim.heel + Math.atan(slopeAcross) * 0.5 * motion + Math.sin(now * 1.7 + L * 5) * 0.012 * motion;
    this.root.rotation.set(0, -sim.heading, 0, 'YZX');
    this.heel.rotation.set(roll, 0, pitch, 'XZY');

    // the rig: the boom follows the sim's trim; the sail is hoisted, then fills with a snap
    const boom = sim.boom + (sim.luff > 0.5 ? Math.sin(now * 3.1) * 0.06 * sim.luff * motion : 0);
    this.boomPivot.rotation.y = boom;
    const hoist = Math.max(0.03, smooth(T_HOIST[0], T_HOIST[1], age));
    const tau = age - T_FILL;
    const snap = tau <= 0 ? 0 : tau > 3 ? 1 : 1 - Math.exp(-tau * 5) * Math.cos(tau * 15);
    this.shapeSail(boom, hoist, snap * (1 - sim.luff), Math.min(1, sim.luff + (age < T_FILL ? 0.6 : 0)), now);

    // the pennant streams downwind, whatever the boat is doing
    const windLocal = Math.atan2(WIND_TO[1], WIND_TO[0]) - sim.heading;
    this.pennant.rotation.set(Math.sin(now * 9) * 0.3 * motion, -windLocal, 0);

    // sailing away: smaller toward the horizon, then gone in specks
    let fade = 1;
    let scale = 1;
    if (this.leftAt !== null) {
      const p = Math.min(1, (now - this.leftAt) / 7);
      scale = 1 - 0.55 * smooth(0, 1, p);
      fade = 1 - smooth(0.35, 1, p);
    }
    this.root.scale.setScalar(scale);
    for (const m of [this.hullMat, this.sailMat, this.sparMat, this.pennant.material as THREE.ShaderMaterial]) {
      m.uniforms.uFade.value = fade;
      m.uniforms.uHighlight.value = this.highlight;
    }
    (this.nameTag.material as THREE.MeshBasicMaterial).opacity = fade;
  }

  /** How far into its reveal (0..1), for tests. */
  revealProgress(now: number): number {
    return Math.min(1, (now - this.born) / (T_FILL + 0.5));
  }

  dispose(): void {
    this.disposed = true;
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    for (const m of [this.hullMat, this.sailMat, this.sparMat, this.pennant.material as THREE.Material]) m.dispose();
    const nm = this.nameTag.material as THREE.MeshBasicMaterial;
    nm.map?.dispose();
    nm.dispose();
  }
}

export { LAUNCH_TIME };
