import * as THREE from 'three';

/**
 * A planar mirror for the water (after three.js's Reflector): the scene is
 * drawn once more from the camera reflected in y = 0, at half resolution,
 * with an oblique near plane so nothing under the water leaks in. The water
 * samples it, breaks it into ripples and lays it on as a glaze — houses, the
 * lighthouse, sails and hulls all show in the harbour.
 */

const NORMAL = new THREE.Vector3(0, 1, 0);
const ORIGIN = new THREE.Vector3(0, 0, 0);
const CLIP_BIAS = 0.003;

export class WaterReflection {
  readonly target: THREE.WebGLRenderTarget;
  readonly matrix = new THREE.Matrix4();
  private readonly virtual = new THREE.PerspectiveCamera();
  private readonly view = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private readonly rot = new THREE.Matrix4();
  private readonly plane = new THREE.Plane();
  private readonly clip = new THREE.Vector4();
  private readonly q = new THREE.Vector4();
  private readonly clear = new THREE.Color();
  /** Objects hidden while the mirror is drawn (the water itself). */
  readonly hidden = new Set<THREE.Object3D>();
  enabled = true;

  constructor(private readonly scale = 0.5) {
    this.target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 0 });
    this.target.texture.generateMipmaps = false;
  }

  setSize(width: number, height: number): void {
    this.target.setSize(Math.max(4, Math.round(width * this.scale)), Math.max(4, Math.round(height * this.scale)));
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    if (!this.enabled) return;
    this.camPos.setFromMatrixPosition(camera.matrixWorld);
    this.view.subVectors(ORIGIN, this.camPos);
    if (this.view.dot(NORMAL) > 0) return; // looking from under the water
    this.view.reflect(NORMAL).negate().add(ORIGIN);
    this.rot.extractRotation(camera.matrixWorld);
    this.look.set(0, 0, -1).applyMatrix4(this.rot).add(this.camPos);
    const target = new THREE.Vector3().subVectors(ORIGIN, this.look).reflect(NORMAL).negate().add(ORIGIN);

    const v = this.virtual;
    v.position.copy(this.view);
    v.up.set(0, 1, 0).applyMatrix4(this.rot).reflect(NORMAL);
    v.lookAt(target);
    v.far = camera.far;
    v.updateMatrixWorld();
    v.projectionMatrix.copy(camera.projectionMatrix);

    this.matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.matrix.multiply(v.projectionMatrix).multiply(v.matrixWorldInverse);

    // oblique near plane: clip everything below the water
    this.plane.setFromNormalAndCoplanarPoint(NORMAL, ORIGIN).applyMatrix4(v.matrixWorldInverse);
    this.clip.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const e = v.projectionMatrix.elements;
    this.q.set((Math.sign(this.clip.x) + e[8]) / e[0], (Math.sign(this.clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    this.clip.multiplyScalar(2 / this.clip.dot(this.q));
    e[2] = this.clip.x;
    e[6] = this.clip.y;
    e[10] = this.clip.z + 1 - CLIP_BIAS;
    e[14] = this.clip.w;

    for (const o of this.hidden) o.visible = false;
    const prevTarget = renderer.getRenderTarget();
    renderer.getClearColor(this.clear);
    const prevAlpha = renderer.getClearAlpha();
    renderer.setClearColor(this.clear, 0);
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, v);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(this.clear, prevAlpha);
    for (const o of this.hidden) o.visible = true;
  }

  dispose(): void {
    this.target.dispose();
  }
}
