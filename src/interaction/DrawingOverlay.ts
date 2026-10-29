import type { Pt } from './stroke';

/**
 * The pen line, drawn in an SVG over the canvas: thin, cream, with a soft
 * halo. An accepted outline lingers while the boat is painted in over it,
 * then fades; a rejected one shivers away. Dragging from a boat draws a
 * faint dashed course line to where it will be sent.
 */

const NS = 'http://www.w3.org/2000/svg';

export function pathData(pts: readonly Pt[]): string {
  if (pts.length === 0) return '';
  if (pts.length < 3) return `M${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L')}`;
  // quadratic curves through midpoints: smooth without overshoot
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    d += ` Q${pts[i].x.toFixed(1)},${pts[i].y.toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L${last.x.toFixed(1)},${last.y.toFixed(1)}`;
}

export class DrawingOverlay {
  readonly svg: SVGSVGElement;
  private live: SVGPathElement | null = null;

  constructor(parent: HTMLElement) {
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.classList.add('ink');
    this.svg.setAttribute('aria-hidden', 'true');
    parent.appendChild(this.svg);
  }

  private course: SVGLineElement | null = null;

  begin(): void {
    this.settle(null);
    this.live = document.createElementNS(NS, 'path');
    this.live.classList.add('ink-line');
    this.svg.append(this.live);
  }

  /** The dashed course line from a boat to the pointer (null hides it). ok = there is water there. */
  setCourse(from: { x: number; y: number } | null, to: { x: number; y: number }, ok: boolean): void {
    if (!from) {
      this.course?.remove();
      this.course = null;
      return;
    }
    if (!this.course) {
      this.course = document.createElementNS(NS, 'line');
      this.course.classList.add('course-line');
      this.svg.append(this.course);
    }
    this.course.setAttribute('x1', from.x.toFixed(1));
    this.course.setAttribute('y1', from.y.toFixed(1));
    this.course.setAttribute('x2', to.x.toFixed(1));
    this.course.setAttribute('y2', to.y.toFixed(1));
    this.course.classList.toggle('nope', !ok);
  }

  update(pts: readonly Pt[]): void {
    this.live?.setAttribute('d', pathData(pts));
  }

  /**
   * Finish the line. Accepted (a boat id): it lingers under the reveal and
   * fades. Rejected (null): it shivers away.
   */
  settle(acceptedBy: string | null): SVGPathElement | null {
    const line = this.live;
    this.live = null;
    if (!line) return null;
    if (acceptedBy) {
      line.classList.add('ink-accepted');
      line.dataset.boat = acceptedBy;
      window.setTimeout(() => line.classList.add('ink-gone'), 700);
      window.setTimeout(() => line.remove(), 2200);
      return line;
    }
    line.classList.add('ink-reject');
    const done = () => line.remove();
    line.addEventListener('animationend', done, { once: true });
    window.setTimeout(done, 1500); // in case animations are disabled
    return null;
  }

  dispose(): void {
    this.course?.remove();
    this.svg.remove();
  }
}
