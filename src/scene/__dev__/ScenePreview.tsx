// Dev-only preview: mounts just the LatheScene with stock loaded and a turning tool.
// Open /scene-preview.html under `npm run dev`. Query params:
//   ?camera=overview|tool|chuck|tailstock  ?tool=turning|parting|boring|none
//   ?ts=center-drill|drill-1/8|drill-1/4|live-center  ?material=brass|aluminum|steel|delrin
//   ?cut=1  (spindle on and take a facing + turning pass so the profile shows steps and chips fly)
//   ?part=1 (part off a piece so it drops in the tray)
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { CameraPreset, Material, TailstockToolId, ToolId } from '../../engine';
import { useLathe } from '../../store';
import { LatheScene } from '..';

// handy for poking at the store from devtools
window.__lathe = useLathe;

const q = new URLSearchParams(window.location.search);
const store = useLathe.getState();
const material = (q.get('material') ?? 'brass') as Material;
store.dispatch({ type: 'loadStock', stock: { material, diameter: 1, length: 3, stickOut: 1.5 } });
store.dispatch({ type: 'selectTool', tool: (q.get('tool') ?? 'turning') as ToolId });
store.setCamera((q.get('camera') ?? 'overview') as CameraPreset);

function turn(axis: 'x' | 'z' | 'quill', revolutions: number) {
  // small slices so feed stays sane
  const steps = Math.ceil(Math.abs(revolutions) * 4);
  for (let i = 0; i < steps; i++) store.turn(axis, revolutions / steps, 0.5);
}

if (q.get('cut') || q.get('part')) {
  store.dispatch({ type: 'setRpm', rpm: q.get('part') ? 300 : 600 });
  store.dispatch({ type: 'setSpindle', on: true });
  // face: tool to z = 1.49, feed x from 0.75 to past centre
  turn('z', -5.1);
  turn('x', 16);
  turn('x', -16);
  // turn a 0.880" step over 0.6"
  turn('z', 1);
  turn('x', (0.75 - 0.44) / 0.05);
  turn('z', -6);
  turn('x', -(0.75 - 0.44) / 0.05);
  turn('z', 6);
}
if (q.get('part')) {
  store.dispatch({ type: 'setSpindle', on: false });
  store.dispatch({ type: 'selectTool', tool: 'parting' });
  store.dispatch({ type: 'setSpindle', on: true });
  // blade at z = 0.5, plunge past centre
  const z = useLathe.getState().state.z;
  turn('z', (0.5 - z) / 0.1);
  turn('x', 16);
  turn('x', -16);
}
// mount the tailstock tool after cutting so the facing pass doesn't meet the drill
store.dispatch({ type: 'selectTailstockTool', tool: (q.get('ts') ?? 'drill-1/4') as TailstockToolId });
if (q.get('quill')) turn('quill', Number(q.get('quill')) / 0.1);

if (q.get('cut') && !q.get('part')) {
  // keep a light finishing pass going back and forth so chips keep flying
  turn('z', (1.6 - useLathe.getState().state.z) / 0.1);
  turn('x', (useLathe.getState().state.x - 0.42) / 0.05);
  let dir = -1;
  const loop = () => {
    const s = useLathe.getState().state;
    if (s.z < 1.05) dir = 1;
    if (s.z > 1.55) dir = -1;
    store.turn('z', dir * 0.08, 0.016);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <div style={{ position: 'fixed', inset: 0 }}>
        <LatheScene />
      </div>
    </StrictMode>,
  );
}
