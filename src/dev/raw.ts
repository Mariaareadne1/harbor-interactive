import { Engine } from '../engine/Engine';
import { HarbourScene } from '../scene/HarbourScene';

/** Scene only, no interface: for looking at the painting while it is built. */
export function rawScene(root: HTMLElement): void {
  root.innerHTML = '<div class="stage"><canvas></canvas></div>';
  const canvas = root.querySelector('canvas')!;
  const engine = new Engine({ canvas, quality: 'high' });
  const scene = new HarbourScene(engine);
  engine.resize(canvas.clientWidth, canvas.clientHeight);
  engine.start();
  (window as unknown as { __raw: unknown }).__raw = { engine, scene };
}
