import type { Engine } from '../engine/Engine';
import { createTerrain, type Terrain } from './terrain';
import { createBuildings, type Buildings } from './buildings';
import { createProps, type Props } from './props';
import { createHarbourMap, type HarbourMap } from './map';
import { WaterReflection } from './reflection';
import { Water } from './water';
import { LIGHTHOUSE } from './harbour';

/** The harbour's fixed furniture: painted land and water, the town, the lighthouse and its small signs of life. */
export class HarbourScene {
  readonly map: HarbourMap;
  readonly terrain: Terrain;
  readonly buildings: Buildings;
  readonly props: Props;
  readonly reflection: WaterReflection;
  readonly water: Water;
  private readonly reflectionHidden: import('three').Object3D[] = [];
  private readonly rebake = () => this.terrain.bake(this.engine.renderer);

  constructor(private readonly engine: Engine) {
    const { world, scene } = engine;
    this.map = createHarbourMap();
    this.terrain = createTerrain(world, this.map);
    this.terrain.bake(engine.renderer);
    scene.add(this.terrain.mesh);
    this.buildings = createBuildings(world);
    scene.add(this.buildings.mesh);
    this.props = createProps(world, engine.reducedMotion);
    scene.add(this.props.group);
    // clouds hang off the tile's edge; their mirror image would land in the middle of the harbour
    this.props.group.traverse((o) => o.name === 'cloud' && this.reflectionHidden.push(o));
    this.reflection = new WaterReflection(engine.quality === 'high' ? 0.5 : 0.35);
    for (const o of this.reflectionHidden) this.reflection.hidden.add(o);
    this.water = new Water(world, this.map, this.reflection, engine.reducedMotion);
    scene.add(this.water.mesh);
    engine.onPrePass((renderer) => this.reflection.render(renderer, scene, engine.camera));
    engine.onResize((w, h) => this.reflection.setSize(w, h));
    engine.onFrame((dt, t) => {
      this.props.update(dt, t);
      // the lamp shows brightest as the beam swings round toward the viewer (+z)
      const a = t * ((2 * Math.PI) / 12);
      const toCam = Math.atan2(engine.camera.position.z - LIGHTHOUSE.z, engine.camera.position.x - LIGHTHOUSE.x);
      this.buildings.setLamp(0.35 + 0.65 * Math.pow(Math.max(0, Math.cos(a - toCam)), 8));
    });
    // a lost context loses the baked ground with it
    engine.canvas.addEventListener('webglcontextrestored', this.rebake);
  }

  dispose(): void {
    this.engine.canvas.removeEventListener('webglcontextrestored', this.rebake);
    this.terrain.dispose();
    this.water.dispose();
    this.reflection.dispose();
  }
}
