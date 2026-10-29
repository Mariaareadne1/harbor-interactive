import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { meshSDF, sdEllipsoid } from './sdf';
import { woolField } from './wool';
import { noise3 } from './noise';
import {
  BREAKWATER_TIP, BREAKWATER_Y, HOUSES, MOORINGS, QUAY, QUAY_Y, ROCKS, TILE, TREES, WIND_TO, landHeight, quayZ, swellAt, windStrength,
} from './harbour';
import { paintMaterial, withAO } from './paint';
import { LIGHTING_GLSL, NOISE_GLSL, WORLD_UNIFORMS_GLSL } from './shaderChunks';
import { SHADOW_LAYER } from '../engine/shadows';
import type { WorldUniforms } from './world';

/**
 * The harbour's still life and its small signs of life: puff trees and
 * cypresses on the hill, rocks round the point, bollards along the quay,
 * café tables, washing between the houses, mooring buoys bobbing, a flag on
 * the quay streaming in the breeze, a beacon on the breakwater's tip, gulls
 * circling and clouds drifting along the tile's edges. Nothing competes with
 * the boats.
 */

const caster = <T extends THREE.Object3D>(m: T): T => {
  m.layers.enable(SHADOW_LAYER);
  return m;
};

// --- puff material (trees, clouds, gulls): dry-brush silhouettes ------------------------

const puffVertex = /* glsl */ `
attribute float aAO;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vLocal;
varying float vAO;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vLocal = position;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vAO = aAO;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const puffFragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
uniform vec3 uColor;
uniform vec3 uShadeTint;
uniform float uCloud;
uniform float uSeed;
uniform float uSpeck;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vLocal;
varying float vAO;
void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorld);
  float facing = max(dot(N, V), 0.0);
  float speck = hash13(floor(vWorld * uSpeck) + uSeed);
  if (speck > smoothstep(0.0, 0.28, facing) * 1.1) discard;
  float grain = vnoise3(vLocal * 9.0 + uSeed) * 0.6 + vnoise3(vLocal * 26.0) * 0.4;
  vec3 albedo = uColor * (0.9 + 0.18 * grain);
  float ao = mix(0.35, 1.0, vAO);
  float sunVis = uCloud > 0.5 ? 1.0 : castLight(vWorld, 0.08);
  vec3 col = paintLight(albedo, N, sunVis, ao, uCloud > 0.5 ? 0.35 : 0.15);
  float hi = smoothstep(0.55, 0.9, dot(N, uSunDir)) * sunVis;
  col = mix(col, col * vec3(1.12, 1.12, 0.95) + vec3(0.03, 0.03, 0.0), hi * (1.0 - uCloud) * 0.8);
  float shade = 1.0 - smoothstep(-0.2, 0.5, dot(N, uSunDir));
  col = mix(col, col * uShadeTint, shade * 0.6);
  gl_FragColor = vec4(col, 1.0);
}
`;

function puffMaterial(world: WorldUniforms, color: string, shadeTint: string, cloud: boolean, seed: number, speck = 22): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...world,
      uColor: { value: new THREE.Color(color) },
      uShadeTint: { value: new THREE.Color(shadeTint) },
      uCloud: { value: cloud ? 1 : 0 },
      uSeed: { value: seed },
      uSpeck: { value: speck },
    },
    vertexShader: puffVertex,
    fragmentShader: puffFragment,
  });
}

function canopy(seed: number, rx: number, ry: number): THREE.BufferGeometry {
  const r = Math.max(rx, ry);
  const base = (x: number, y: number, z: number) => sdEllipsoid(x, y, z, 0, 0, 0, rx, ry, rx);
  const ext = r * 1.35;
  return meshSDF(
    woolField(base, {
      seed,
      min: [-ext, -ext, -ext],
      max: [ext, ext, ext],
      inset: Math.min(rx, ry) * 0.14,
      layers: [{ count: 30, rMin: rx * 0.26, rMax: rx * 0.4 }, { count: 44, rMin: rx * 0.14, rMax: rx * 0.22 }],
      blend: rx * 0.12,
      curl: 0.004,
    }),
    { min: [-ext, -ext, -ext], max: [ext, ext, ext], cell: Math.min(rx, ry) / 11, ao: true },
  );
}

function cloudShape(seed: number): THREE.BufferGeometry {
  const base = (x: number, y: number, z: number) =>
    Math.min(
      sdEllipsoid(x, y, z, 0, 0, 0, 2.1, 0.75, 1.4),
      sdEllipsoid(x, y, z, 0.9, 0.35, 0.3, 1.1, 0.75, 0.95),
      sdEllipsoid(x, y, z, -1.0, 0.2, -0.3, 0.95, 0.6, 0.9),
    );
  return meshSDF(
    woolField(base, {
      seed,
      min: [-3.2, -1.2, -2.3],
      max: [3.2, 1.6, 2.3],
      inset: 0.22,
      layers: [{ count: 36, rMin: 0.45, rMax: 0.75 }, { count: 60, rMin: 0.22, rMax: 0.38 }],
      blend: 0.25,
      curl: 0.01,
    }),
    { min: [-3.8, -1.6, -2.8], max: [3.8, 2.3, 2.8], cell: 0.1, ao: true },
  );
}

/** A lumpy boulder. */
function rockShape(seed: number, r: number): THREE.BufferGeometry {
  const sdf = (x: number, y: number, z: number) =>
    sdEllipsoid(x, y, z, 0, 0, 0, r, r * 0.62, r * 0.85) + noise3(x * 3.2 / r + seed, y * 3.2 / r, z * 3.2 / r) * r * 0.12;
  const e = r * 1.3;
  return meshSDF(sdf, { min: [-e, -e, -e], max: [e, e, e], cell: r / 9, ao: true });
}

// --- the gull -------------------------------------------------------------------------------

interface Gull { group: THREE.Group; wings: THREE.Mesh[]; cx: number; cz: number; r: number; y: number; speed: number; phase: number }

function gullBody(): THREE.BufferGeometry {
  // a fat little puff of a gull, beak toward +x
  const sdf = (x: number, y: number, z: number) => Math.min(sdEllipsoid(x, y, z, 0, 0, 0, 0.16, 0.08, 0.075), sdEllipsoid(x, y, z, 0.13, 0.04, 0, 0.065, 0.058, 0.058));
  return meshSDF(sdf, { min: [-0.2, -0.12, -0.12], max: [0.24, 0.13, 0.12], cell: 0.012, ao: true });
}

function gullWing(side: 1 | -1): THREE.BufferGeometry {
  // a bent, tapering wing: grey with a dark tip, built along +z (or -z)
  const shape = new THREE.Shape();
  shape.moveTo(0.06, 0);
  shape.quadraticCurveTo(0.03, 0.2, -0.03, 0.34);
  shape.lineTo(-0.07, 0.3);
  shape.quadraticCurveTo(-0.06, 0.12, -0.07, 0);
  const g = new THREE.ShapeGeometry(shape, 6).rotateX(Math.PI / 2 * side);
  g.deleteAttribute('uv');
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const grey = new THREE.Color('#e9ebef'), tip = new THREE.Color('#4c525d');
  for (let i = 0; i < pos.count; i++) {
    const out = Math.abs(pos.getZ(i));
    const c = out > 0.27 ? tip : grey;
    col.set([c.r, c.g, c.b], i * 3);
    pos.setY(i, pos.getY(i) + out * out * 0.25);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return withAO(g);
}

// --- the flag ---------------------------------------------------------------------------------

const FLAG = { x: 2.9, z: quayZ(2.9) - 0.45, pole: 1.15 };

export interface Props {
  group: THREE.Group;
  update(dt: number, time: number): void;
}

export function createProps(world: WorldUniforms, reducedMotion = false): Props {
  const group = new THREE.Group();
  group.name = 'props';
  const calm = reducedMotion ? 0.35 : 1;

  // trees: round puffs and dark cypresses on the hill
  const trunkGeo = withAO(new THREE.CylinderGeometry(0.05, 0.08, 1, 7).translate(0, 0.5, 0));
  const trunkMat = paintMaterial(world, { color: '#7a5a3e' });
  for (const t of TREES) {
    const y = landHeight(t.x, t.z);
    const trunk = caster(new THREE.Mesh(trunkGeo, trunkMat));
    trunk.position.set(t.x, y - 0.05, t.z);
    trunk.scale.set(1, t.tall ? 0.4 : t.r * 1.4, 1);
    const crown = caster(new THREE.Mesh(t.tall ? canopy(t.seed, t.r, t.r * 3.2) : canopy(t.seed, t.r, t.r * 0.88), puffMaterial(world, t.color, t.color === '#e8a7b7' ? '#b8a6dc' : '#8c9fd0', false, t.seed)));
    crown.position.set(t.x, y + (t.tall ? t.r * 3.2 + 0.15 : t.r * 1.4), t.z);
    crown.name = 'tree';
    group.add(trunk, crown);
  }

  // rocks round the point and at the breakwater's root
  const rockMat = paintMaterial(world, { color: '#a9a4a6', softness: 0.18 });
  for (const r of ROCKS) {
    const rock = caster(new THREE.Mesh(rockShape(r.seed, r.r), rockMat));
    rock.position.set(r.x, Math.max(-0.02, landHeight(r.x, r.z) * 0.5) + r.r * 0.12, r.z);
    rock.rotation.y = r.seed * 1.7;
    group.add(rock);
  }

  // bollards along the quay's edge, with the odd coil of rope
  const bollardGeo = withAO(mergeGeometries([new THREE.CylinderGeometry(0.045, 0.055, 0.12, 10).translate(0, 0.06, 0), new THREE.SphereGeometry(0.06, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1).translate(0, 0.12, 0)].map((g) => g.deleteAttribute('uv'))));
  const iron = paintMaterial(world, { color: '#3e4552', gloss: 0.5 });
  const ropeGeo = withAO(new THREE.TorusGeometry(0.07, 0.016, 5, 16).rotateX(Math.PI / 2).deleteAttribute('uv'));
  const rope = paintMaterial(world, { color: '#d8c39a' });
  for (let x = QUAY.x0 + 0.7, i = 0; x < QUAY.x1 - 0.3; x += 1.25, i++) {
    const b = caster(new THREE.Mesh(bollardGeo, iron));
    const z = quayZ(x) - 0.12;
    b.position.set(x, QUAY_Y, z);
    group.add(b);
    if (i % 3 === 1) {
      const coil = caster(new THREE.Mesh(ropeGeo, rope));
      coil.position.set(x + 0.2, QUAY_Y + 0.02, z - 0.08);
      group.add(coil);
    }
  }

  // café tables on the quay, under the awning
  const cafe = HOUSES.find((h) => h.cafe);
  if (cafe) {
    const top = paintMaterial(world, { color: '#f6f2ea' });
    const chairMat = paintMaterial(world, { color: '#4e7395' });
    const tableGeo = withAO(mergeGeometries([new THREE.CylinderGeometry(0.1, 0.1, 0.015, 14).translate(0, 0.17, 0), new THREE.CylinderGeometry(0.012, 0.02, 0.17, 6).translate(0, 0.085, 0)].map((g) => g.deleteAttribute('uv'))));
    const chairGeo = withAO(new THREE.BoxGeometry(0.07, 0.1, 0.07).translate(0, 0.05, 0).deleteAttribute('uv'));
    for (const du of [-0.24, 0.24]) {
      const x = cafe.x + Math.cos(cafe.rot) * du, z = quayZ(cafe.x + du) - 0.6;
      const tbl = caster(new THREE.Mesh(tableGeo, top));
      tbl.position.set(x, QUAY_Y, z);
      group.add(tbl);
      for (const s of [-1, 1]) {
        const ch = caster(new THREE.Mesh(chairGeo, chairMat));
        ch.position.set(x + s * 0.14, QUAY_Y, z);
        group.add(ch);
      }
    }
  }

  // washing strung between two houses on the second terrace
  const washing: { mesh: THREE.Mesh; rest: Float32Array; phase: number }[] = [];
  const row2 = HOUSES.filter((h) => Math.abs(h.y - QUAY_Y - 0.5) < 0.05).sort((a, b) => a.x - b.x);
  for (let i = 0; i + 1 < row2.length && washing.length < 8; i += 3) {
    const a = row2[i], b = row2[i + 1];
    const ax = a.x + a.w / 2, bx = b.x - b.w / 2;
    if (bx - ax < 0.1) continue;
    const y = a.y + Math.min(a.wallH, b.wallH) * 0.62;
    const z = (a.z + b.z) / 2 + 0.3;
    const line = new THREE.Mesh(withAO(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(ax, y, z), new THREE.Vector3((ax + bx) / 2, y - 0.05, z), new THREE.Vector3(bx, y, z)), 8, 0.004, 3).deleteAttribute('uv')), paintMaterial(world, { color: '#efe9dd' }));
    group.add(line);
    const colors = ['#f6f2ea', '#8fb4d9', '#e9a3a3', '#e8cf7a'];
    const n = Math.max(1, Math.floor((bx - ax) / 0.16));
    for (let k = 0; k < n; k++) {
      const u = ax + ((k + 0.5) / n) * (bx - ax);
      const w = 0.09, h = 0.1 + (k % 2) * 0.03;
      const geo = withAO(new THREE.PlaneGeometry(w, h, 3, 3).translate(0, -h / 2, 0));
      geo.deleteAttribute('uv');
      const mesh = caster(new THREE.Mesh(geo, paintMaterial(world, { color: colors[(k + i) % colors.length], side: THREE.DoubleSide, softness: 0.3 })));
      mesh.position.set(u, y - 0.05 * (1 - (2 * (u - ax) / (bx - ax) - 1) ** 2), z);
      group.add(mesh);
      washing.push({ mesh, rest: Float32Array.from(geo.getAttribute('position').array as Float32Array), phase: k * 1.3 + i });
    }
  }

  // mooring buoys: little red-and-white floats
  const buoyGeo = withAO(mergeGeometries([new THREE.SphereGeometry(0.075, 12, 8).deleteAttribute('uv'), new THREE.CylinderGeometry(0.012, 0.012, 0.09, 5).translate(0, 0.1, 0).deleteAttribute('uv')]));
  const buoyMat = paintMaterial(world, { color: '#e2533f', gloss: 0.4 });
  const buoys = MOORINGS.map(([x, z]) => {
    const b = caster(new THREE.Mesh(buoyGeo, buoyMat));
    b.position.set(x, 0.02, z);
    group.add(b);
    return b;
  });

  // a green beacon on the breakwater's tip
  const beacon = caster(new THREE.Mesh(withAO(mergeGeometries([new THREE.CylinderGeometry(0.06, 0.08, 0.5, 8).translate(0, 0.25, 0), new THREE.CylinderGeometry(0.09, 0.06, 0.1, 8).translate(0, 0.55, 0)].map((g) => g.deleteAttribute('uv')))), paintMaterial(world, { color: '#4f9a6c' })));
  beacon.position.set(BREAKWATER_TIP[0], BREAKWATER_Y, BREAKWATER_TIP[1]);
  group.add(beacon);

  // the flag on the quay: a pole and a cloth that streams downwind
  const pole = caster(new THREE.Mesh(withAO(new THREE.CylinderGeometry(0.012, 0.018, FLAG.pole, 6).translate(0, FLAG.pole / 2, 0).deleteAttribute('uv')), paintMaterial(world, { color: '#f4efe6' })));
  pole.position.set(FLAG.x, QUAY_Y, FLAG.z);
  group.add(pole);
  const flagGeo = withAO(new THREE.PlaneGeometry(0.34, 0.2, 10, 4).translate(0.17, -0.1, 0).deleteAttribute('uv'));
  const flagRest = Float32Array.from(flagGeo.getAttribute('position').array as Float32Array);
  const flag = caster(new THREE.Mesh(flagGeo, paintMaterial(world, { color: '#4e7fb6', side: THREE.DoubleSide, softness: 0.3 })));
  flag.position.set(FLAG.x, QUAY_Y + FLAG.pole, FLAG.z);
  flag.rotation.y = -Math.atan2(WIND_TO[1], WIND_TO[0]);
  group.add(flag);

  // gulls circling over the harbour
  const gullMat = puffMaterial(world, '#fbfaf6', '#d6daf0', false, 31, 60);
  const wingMat = paintMaterial(world, { vertexColors: true, side: THREE.DoubleSide, softness: 0.3 });
  const beakMat = paintMaterial(world, { color: '#e9b44c' });
  const bodyGeo = gullBody();
  const gulls: Gull[] = [
    { cx: -2.5, cz: -0.5, r: 3.2, y: 2.6, speed: 0.22, phase: 0 },
    { cx: 1.0, cz: 1.0, r: 2.4, y: 3.1, speed: -0.27, phase: 2 },
    { cx: 4.5, cz: 3.0, r: 2.8, y: 2.3, speed: 0.19, phase: 4 },
  ].map((g) => {
    const group2 = new THREE.Group();
    group2.add(caster(new THREE.Mesh(bodyGeo, gullMat)));
    const beak = new THREE.Mesh(withAO(new THREE.ConeGeometry(0.018, 0.06, 6).rotateZ(-Math.PI / 2).translate(0.21, 0.04, 0).deleteAttribute('uv')), beakMat);
    group2.add(beak);
    const wings = ([1, -1] as const).map((s) => {
      const w = caster(new THREE.Mesh(gullWing(s), wingMat));
      w.position.set(0.02, 0.03, s * 0.05);
      group2.add(w);
      return w;
    });
    group2.scale.setScalar(1.15);
    group.add(group2);
    return { ...g, group: group2, wings };
  });

  // clouds along the back and right edges, as in the references
  const clouds: { mesh: THREE.Mesh; speed: number; size: number; axis: 'x' | 'z'; span: number }[] = [];
  const cloudDefs = [
    { x: -3, y: 5.6, z: -TILE.halfZ - 1.6, s: 0.85, seed: 11, speed: -0.14, axis: 'x' as const, span: 15 },
    { x: TILE.halfX + 1.8, y: 5.0, z: 2, s: 0.7, seed: 12, speed: 0.11, axis: 'z' as const, span: 10 },
  ];
  for (const c of cloudDefs) {
    const mesh = caster(new THREE.Mesh(cloudShape(c.seed), puffMaterial(world, '#fbfaf6', '#dfe2f5', true, c.seed)));
    mesh.position.set(c.x, c.y, c.z);
    mesh.scale.setScalar(c.s);
    mesh.name = 'cloud';
    group.add(mesh);
    clouds.push({ mesh, speed: c.speed, size: c.s, axis: c.axis, span: c.span });
  }

  const flagPos = flagGeo.getAttribute('position') as THREE.BufferAttribute;
  return {
    group,
    update(dt: number, time: number) {
      for (const c of clouds) {
        const p = c.mesh.position;
        p[c.axis] += c.speed * dt * calm;
        if (p[c.axis] > c.span) p[c.axis] = -c.span;
        if (p[c.axis] < -c.span) p[c.axis] = c.span;
        const fade = Math.min(1, (c.span - Math.abs(p[c.axis])) / 3.5);
        c.mesh.scale.setScalar(c.size * Math.max(0.001, fade * fade * (3 - 2 * fade)));
      }
      // buoys bob and nod on the swell
      buoys.forEach((b, i) => {
        const s = swellAt(b.position.x, b.position.z, time);
        b.position.y = 0.015 + s.h * 1.4 * calm;
        b.rotation.set(s.dz * 3 * calm, 0, -s.dx * 3 * calm + Math.sin(time * 1.3 + i) * 0.05 * calm);
      });
      // the flag streams downwind, snapping harder in the gusts
      const wind = windStrength(time);
      for (let i = 0; i < flagPos.count; i++) {
        const x = flagRest[i * 3], y = flagRest[i * 3 + 1];
        const k = x / 0.34;
        const wave = Math.sin(x * 22 - time * 9 * wind) * 0.03 * k * (0.6 + 0.4 * wind) * calm + Math.sin(x * 9 - time * 4) * 0.015 * k * calm;
        flagPos.setXYZ(i, x * (0.96 + 0.04 * wind), y - k * k * 0.04 * (1.3 - wind), wave);
      }
      flagPos.needsUpdate = true;
      flag.geometry.computeVertexNormals();
      // washing sways in the breeze
      for (const cl of washing) {
        const pos = cl.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          const x = cl.rest[i * 3], y = cl.rest[i * 3 + 1];
          const hang = -y;
          const billow = (Math.sin(time * 2.1 * wind + cl.phase + x * 8) * 0.5 + Math.sin(time * 3.3 + cl.phase * 2) * 0.3) * hang * 0.5 * calm;
          pos.setZ(i, cl.rest[i * 3 + 2] + billow);
        }
        pos.needsUpdate = true;
        cl.mesh.geometry.computeVertexNormals();
      }
      // gulls wheel round on lazy circles, flapping now and then and gliding between
      for (const g of gulls) {
        const a = g.phase + time * g.speed * calm;
        const x = g.cx + Math.cos(a) * g.r, z = g.cz + Math.sin(a) * g.r * 0.7;
        g.group.position.set(x, g.y + Math.sin(time * 0.7 + g.phase) * 0.15, z);
        const dir = Math.sign(g.speed);
        g.group.rotation.set(0, -Math.atan2(Math.cos(a) * g.r * 0.7 * dir, -Math.sin(a) * g.r * dir), -0.25 * dir);
        const flapping = Math.sin(time * 0.6 + g.phase * 3) > 0.2;
        const flap = flapping ? Math.sin(time * 9 + g.phase) * 0.5 * calm : 0.12;
        g.wings[0].rotation.x = flap;
        g.wings[1].rotation.x = -flap;
      }
    },
  };
}

/** Where the flag is: tests check it streams with the wind. */
export const FLAG_SPOT = FLAG;
