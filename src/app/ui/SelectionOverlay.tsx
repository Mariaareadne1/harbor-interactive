import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { HarborApp } from '../HarborApp';
import { useAppState } from '../../state/store';
import { BOAT_METRES } from '../../scene/harbour';
import { pointOfSail } from '../../sail/sim';
import { MAX_NAME } from '../../boat/names';
import { Icon } from './icons';

/**
 * A thin blue box around the selected boat with a readout — its length and
 * its point of sail — and a small bar with only what a boat can be asked:
 * its name, sail out, come home, and remove. Positions are written straight
 * to the DOM every frame; no React renders.
 */

export function SelectionOverlay({ app }: { app: HarborApp }) {
  const selection = useAppState(app.store, (s) => s.selection);
  const record = useAppState(app.store, (s) => (selection ? s.history.present.boats.find((b) => b.id === selection.id) ?? null : null));
  const boxRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selection) return;
    const corner = new THREE.Vector3();
    let lastText = '';
    const update = () => {
      const box = boxRef.current;
      const bar = barRef.current;
      const boat = app.boats.get(selection.id);
      const sim = app.boats.sim(selection.id);
      if (!box || !bar || !boat) return;
      const cam = app.engine.camera;
      const rect = app.rect;
      const c = boat.position;
      const r = boat.length * 0.58;
      const mast = 0.62 + 0.55 * boat.length;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < 8; i++) {
        corner.set(c.x + (i & 1 ? 1 : -1) * r, c.y + (i & 2 ? mast * 0.9 : -0.05), c.z + (i & 4 ? 1 : -1) * r).project(cam);
        const sx = ((corner.x + 1) / 2) * rect.width;
        const sy = ((1 - corner.y) / 2) * rect.height;
        minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
        minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
      }
      box.style.transform = `translate(${minX.toFixed(1)}px, ${minY.toFixed(1)}px)`;
      box.style.width = `${(maxX - minX).toFixed(1)}px`;
      box.style.height = `${(maxY - minY).toFixed(1)}px`;
      if (labelRef.current && sim) {
        const text = `${(boat.length * BOAT_METRES).toFixed(1)} m  ·  ${pointOfSail(sim)}`;
        if (text !== lastText) labelRef.current.textContent = lastText = text;
      }
      // the bar sits under the box, or above it near the bottom edge
      const barW = bar.offsetWidth;
      const barH = bar.offsetHeight;
      const cx = Math.min(rect.width - barW / 2 - 12, Math.max(barW / 2 + 12, (minX + maxX) / 2));
      const below = maxY + 34 + barH < rect.height - 84;
      const y = below ? maxY + 30 : minY - barH - 12;
      bar.style.transform = `translate(${(cx - barW / 2).toFixed(1)}px, ${Math.max(8, y).toFixed(1)}px)`;
    };
    update();
    return app.engine.onBeforeRender(update);
  }, [app, selection]);

  if (!selection || !record) return null;
  const id = selection.id;
  return (
    <>
      <div className="select-box" ref={boxRef} aria-hidden="true">
        <i className="h tl" /><i className="h tr" /><i className="h bl" /><i className="h br" />
        <span className="select-label" ref={labelRef} />
      </div>
      <div className="action-bar" ref={barRef} role="toolbar" aria-label="Selected boat">
        <NameField key={`${id}:${record.name}`} name={record.name} onCommit={(n) => app.rename(id, n)} />
        <button className="icon-btn dice" title="Another name" aria-label="Roll a new name" onClick={() => app.rollName(id)}><Icon name="dice" /></button>
        <span className="sep" />
        <Chip label="Sail out" icon="out" title="Sail out to sea (O)" on={record.mode === 'out'} onClick={() => app.sailOut(id)} />
        <Chip label="Come home" icon="home" title="Come home to a mooring (M)" on={record.mode === 'home'} onClick={() => app.comeHome(id)} />
        <span className="sep" />
        <button className="icon-btn" title="Remove (Delete)" aria-label="Remove boat" onClick={() => app.remove(id)}><Icon name="trash" /></button>
      </div>
    </>
  );
}

function NameField({ name, onCommit }: { name: string; onCommit: (name: string) => void }) {
  const [value, setValue] = useState(name);
  return (
    <input
      className="name-field"
      aria-label="Boat name"
      value={value}
      maxLength={MAX_NAME}
      spellCheck={false}
      size={Math.max(6, Math.min(MAX_NAME, value.length + 1))}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setValue(name);
          (e.target as HTMLInputElement).blur();
        }
        e.stopPropagation();
      }}
    />
  );
}

function Chip({ label, title, on, onClick, icon }: { label: string; title?: string; on?: boolean; onClick: () => void; icon?: Parameters<typeof Icon>[0]['name'] }) {
  return (
    <button className={on ? 'chip on' : 'chip'} title={title ?? label} aria-pressed={on} onClick={onClick}>
      {icon && <Icon name={icon} />}
      <span>{label}</span>
    </button>
  );
}
