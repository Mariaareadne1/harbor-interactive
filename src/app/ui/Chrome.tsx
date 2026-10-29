import { useEffect, useRef, useState } from 'react';
import type { HarborApp } from '../HarborApp';
import { useAppState } from '../../state/store';
import { canRedo, canUndo } from '../../state/history';
import { showcaseDoc } from '../../state/document';
import { exportDocFile, importDocFile } from '../../state/persistence';
import { Icon } from './icons';

interface ChromeProps {
  app: HarborApp;
  onCapture: () => void;
  onRecord: () => void;
}

const SHORTCUTS: [string, string][] = [
  ['Sail out', 'O'],
  ['Come home', 'M'],
  ['Remove', 'Delete'],
  ['Select next boat', 'Tab'],
  ['Undo · Redo', '⌘Z · ⇧⌘Z'],
  ['Deselect / cancel', 'Esc'],
  ['Hide interface', 'H'],
];

export function Chrome({ app, onCapture, onRecord }: ChromeProps) {
  const { store } = app;
  const history = useAppState(store, (s) => s.history);
  const hasDrawn = useAppState(store, (s) => s.hasDrawn);
  const boatCount = useAppState(store, (s) => s.history.present.boats.length);
  const toast = useAppState(store, (s) => s.toast);
  const loading = useAppState(store, (s) => s.loading);
  const recording = useAppState(store, (s) => s.recording);
  const selection = useAppState(store, (s) => s.selection);
  const tool = useAppState(store, (s) => s.tool);
  const [panel, setPanel] = useState<'none' | 'help' | 'menu'>('none');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (panel === 'none') return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.panel, .top-actions')) setPanel('none');
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [panel]);

  const hint = hasDrawn || selection !== null || boatCount > 3 || tool !== 'draw' ? null : 'Draw a boat on the water.';

  const runMenu = (action: string) => {
    setPanel('none');
    if (action === 'reset') app.reset();
    if (action === 'showcase') app.loadDoc(showcaseDoc());
    if (action === 'export') exportDocFile(store.doc);
    if (action === 'import') fileRef.current?.click();
    if (action === 'hide') store.set({ uiHidden: true });
    if (action === 'record') onRecord();
  };

  return (
    <>
      <header className="wordmark">
        <h1>HARBOR</h1>
        <p>draw a boat</p>
      </header>

      <div className="top-actions">
        <button className="icon-btn ghost" aria-label="Help" aria-expanded={panel === 'help'} title="Help" onClick={() => setPanel(panel === 'help' ? 'none' : 'help')}>
          <Icon name="help" />
        </button>
        <button className="icon-btn ghost" aria-label="Harbour menu" aria-expanded={panel === 'menu'} title="More" onClick={() => setPanel(panel === 'menu' ? 'none' : 'menu')}>
          <Icon name="menu" />
        </button>
      </div>

      {panel === 'help' && (
        <section className="panel help" aria-label="How to play">
          <p className="lede">Draw the outline of a boat on the water — long and sleek, round and tubby, any shape you like — and it becomes a little sailing dinghy that sets off. Drag from a boat to anywhere on the water to send it there; it tacks if it has to sail upwind. Tap a boat to name it, send it out to sea or call it home.</p>
          <dl>
            {SHORTCUTS.map(([what, key]) => (
              <div key={what}><dt>{what}</dt><dd>{key}</dd></div>
            ))}
          </dl>
        </section>
      )}
      {panel === 'menu' && (
        <section className="panel menu" aria-label="Harbour menu">
          <button onClick={() => runMenu('showcase')}>Showcase</button>
          <button onClick={() => runMenu('record')} disabled={recording}>Record 12-second clip</button>
          <button onClick={() => runMenu('hide')}>Hide interface <kbd>H</kbd></button>
          <hr />
          <button onClick={() => runMenu('export')}>Export scene…</button>
          <button onClick={() => runMenu('import')}>Import scene…</button>
          <hr />
          <button className="danger" onClick={() => runMenu('reset')} disabled={boatCount === 0}>Clear the harbour</button>
        </section>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try {
            app.loadDoc(await importDocFile(file));
            store.toast('Scene imported.');
          } catch (err) {
            store.toast(err instanceof Error ? err.message : 'Could not import that file.');
          }
        }}
      />

      {hint && <p key={hint} className="hint" aria-live="polite">{hint}</p>}
      {loading && <p className="loading" aria-live="polite">Mixing the paint…</p>}

      <nav className="toolbar" aria-label="Tools">
        <button className={tool === 'draw' ? 'tool on' : 'tool'} aria-pressed={tool === 'draw'} title="Draw a boat" onClick={() => store.set({ tool: 'draw' })}>
          <Icon name="draw" /><span>Draw</span>
        </button>
        <button className={tool === 'move' ? 'tool on' : 'tool'} aria-pressed={tool === 'move'} title="Move: drag a boat to send it somewhere" onClick={() => store.set({ tool: 'move' })}>
          <Icon name="move" /><span>Move</span>
        </button>
        <span className="sep" />
        <button className="icon-btn" aria-label="Undo" title="Undo (⌘Z)" disabled={!canUndo(history)} onClick={() => app.undo()}><Icon name="undo" /></button>
        <button className="icon-btn" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!canRedo(history)} onClick={() => app.redo()}><Icon name="redo" /></button>
        <span className="sep" />
        <button className="icon-btn" aria-label="Save image" title="Save image" onClick={onCapture}><Icon name="camera" /></button>
      </nav>

      {recording && <p className="rec" aria-live="polite"><i />Recording</p>}
      {toast && <Toast key={toast.id} text={toast.text} />}
    </>
  );
}

function Toast({ text }: { text: string }) {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setGone(true), 3200);
    return () => window.clearTimeout(t);
  }, []);
  if (gone) return null;
  return <p className="toast" role="status">{text}</p>;
}
