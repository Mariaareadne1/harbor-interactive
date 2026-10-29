// Close-ups of boats for visual QA: node scripts/closeup.mjs <name> [query]
// Draws three very different hulls (tubby, sleek, lopsided) with real pointer strokes,
// lets them paint in, then photographs each from four angles.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [name = 'closeup', query = 'empty'] = process.argv.slice(2);
const base = process.env.HARBOR_URL ?? 'http://localhost:5394/';
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: Number(process.env.DPR ?? 1) });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${base}?${query}`);
await page.waitForFunction(() => window.__harbor && !window.__harbor.store.get().loading);

const shapes = {
  tubby: (t) => 0.5 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + t * 0.94)), 0.6),
  sleek: (t) => 0.17 * Math.sin(Math.PI * Math.pow(t, 0.7)),
  lopsided: (t) => 0.3 * Math.sin(Math.PI * Math.pow(t, 0.8)),
};
const spots = { tubby: [-5.5, 0.4, 1.0], sleek: [-1.5, 0.6, 1.8], lopsided: [2.0, -0.6, 1.3] };
for (const [key, f] of Object.entries(shapes)) {
  const [cx, cz, len] = spots[key];
  const pts = await page.evaluate(([cx, cz, len, src, lop]) => {
    const f = new Function('t', `return (${src})(t)`);
    const s = window.__harbor, cam = s.engine.camera, r = s.engine.canvas.getBoundingClientRect();
    const out = [];
    for (let i = 0; i <= 70; i++) {
      const a = (i / 70) * Math.PI * 2, t = 0.5 + 0.5 * Math.cos(a);
      let v = Math.sin(a) * f(t);
      if (lop && v > 0) v *= 1.7;
      const p = cam.position.clone().set(cx + (t - 0.5) * len, 0, cz + v).project(cam);
      out.push([r.left + ((p.x + 1) / 2) * r.width, r.top + ((1 - p.y) / 2) * r.height]);
    }
    return out;
  }, [cx, cz, len, f.toString(), key === 'lopsided']);
  await page.mouse.move(pts[0][0], pts[0][1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y);
  await page.mouse.up();
  await page.waitForTimeout(200);
}
// freeze the sailing, let the reveals finish
await page.waitForTimeout(3500);
await page.evaluate(() => window.__harbor.engine.stop());
const ids = await page.evaluate(() => window.__harbor.app.boats.ids());
console.log('boats', ids.length);
const shots = [];
for (const [i, id] of ids.entries()) {
  for (const [k, ang] of [0, 1.6, 3.2, 4.7].entries()) {
    await page.evaluate(([id, ang]) => {
      const s = window.__harbor, b = s.app.boats.get(id), p = b.position;
      const d = 2.2 + b.length;
      s.engine.debugView({ x: p.x + Math.cos(ang) * d, y: 1.3 + b.length * 0.5, z: p.z + Math.sin(ang) * d }, { x: p.x, y: 0.35, z: p.z }, 40);
      s.engine.render();
    }, [id, ang]);
    const file = `artifacts/${name}-${i}-${k}.png`;
    await page.screenshot({ path: file });
    shots.push(file);
  }
}
console.log(shots.join(' '));
await browser.close();
