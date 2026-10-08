// App shell (DESIGN.md section 11): header, 3D viewport with DRO and toast overlays, bottom tabs
// (Project / Section view / Log) and the control panel.
import './ui/theme.css';
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { logo } from './art';
import { getChallenge, getLessonMeta } from './content';
import type { CameraPreset, PlayerStatus } from './engine';
import { ProjectTab } from './projects';
import { selectControlsLocked, useLathe, type Demo, type Mode } from './store';
import { ControlPanel, DRO, EventLog, SectionView, Toasts, sectionBounds } from './ui';
import { SceneErrorBoundary, SceneFallback } from './scene/SceneErrorBoundary';
import { exposeDevHandle } from './app/devHandle';
import { HelpMenu, SettingsMenu } from './app/HeaderMenus';
import { useNo3dSetting } from './app/settings';
import { fitWidth, useElementSize } from './app/useElementSize';
import { useFallbackTicker } from './app/useFallbackTicker';
import styles from './App.module.css';

// three.js + R3F are big; load them in their own chunk so the controls show up first
const LatheScene = lazy(() => import('./scene/LatheScene').then((m) => ({ default: m.LatheScene })));

export const CAMERA_BUTTONS: readonly { id: CameraPreset; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'tool', label: 'Tool' },
  { id: 'chuck', label: 'Chuck' },
  { id: 'tailstock', label: 'Tailstock' },
];

export type TabId = 'project' | 'section' | 'log';
const TABS: readonly { id: TabId; label: string }[] = [
  { id: 'project', label: 'Project' },
  { id: 'section', label: 'Section view' },
  { id: 'log', label: 'Log' },
];

/** Text for the header badge. */
export function modeLabel(mode: Mode): string {
  switch (mode.kind) {
    case 'lesson':
      return `Lesson: ${getLessonMeta(mode.id)?.title ?? mode.id} · ${mode.doItYourself ? 'Do it yourself' : 'Watch'}`;
    case 'challenge':
      return `Challenge: ${getChallenge(mode.id)?.title ?? mode.id}`;
    default:
      return 'Free play';
  }
}

/**
 * Controls are locked while a demo drives the machine: a watched lesson or a challenge solution
 * that is playing, or a do-it-yourself "Show me" demo.
 */
export function controlsLocked(mode: Mode, playing: boolean, demo: Demo = null): boolean {
  return selectControlsLocked({ mode, demo, playerStatus: playing ? ({ playing } as PlayerStatus) : null });
}

/** Banner text while the controls are locked. */
export function lockedMessage(mode: Mode, demo: Demo): string {
  if (demo) return 'Showing you this step: the controls are locked until it finishes.';
  if (mode.kind === 'challenge') return 'Playing the solution: the controls are locked. Pause it, or take over to finish by hand.';
  return 'Watching a demo: the controls are locked. Pause it, or take over, to use them.';
}

function CameraButtons() {
  const camera = useLathe((s) => s.camera);
  const setCamera = useLathe((s) => s.setCamera);
  return (
    <div className={styles.group} role="group" aria-label="Camera">
      {CAMERA_BUTTONS.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`${styles.headerButton} ${camera === c.id ? styles.active : ''}`}
          aria-pressed={camera === c.id}
          data-testid={`cam-${c.id}`}
          onClick={() => setCamera(c.id)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

function SlowNotice({ fps, onTurnOff, onDismiss }: { fps: number; onTurnOff: () => void; onDismiss: () => void }) {
  return (
    <div className={styles.slowNotice} role="status" data-testid="slow-3d">
      <span>
        The 3D view is running slowly (about {Math.round(fps)} frames a second). Turning it off keeps everything
        else working.
      </span>
      <button type="button" className={styles.lockedButton} data-testid="slow-3d-off" onClick={onTurnOff}>
        Turn off 3D
      </button>
      <button type="button" className={styles.headerButton} data-testid="slow-3d-dismiss" onClick={onDismiss}>
        Keep it
      </button>
    </div>
  );
}

function Viewport({ off, onSceneDown, onTurnOff3d }: { off: boolean; onSceneDown: () => void; onTurnOff3d: () => void }) {
  const [slow, setSlow] = useState<number | null>(null);
  const onSlow = useCallback((fps: number) => setSlow(fps), []);
  return (
    <div className={styles.viewport}>
      {off ? (
        <SceneFallback
          title="3D view is off."
          message="It was turned off in Settings or by the address. The machine still runs: follow the cut in the section view and the DRO."
        />
      ) : (
        <SceneErrorBoundary onError={onSceneDown}>
          <Suspense
            fallback={
              <div className={styles.loading} data-testid="scene-loading" role="status">
                Loading the 3D view…
              </div>
            }
          >
            <LatheScene onUnavailable={onSceneDown} onSlow={onSlow} />
          </Suspense>
        </SceneErrorBoundary>
      )}
      <DRO className={styles.dro} />
      <Toasts className={styles.toasts} />
      {!off && slow !== null && (
        <SlowNotice
          fps={slow}
          onTurnOff={() => {
            setSlow(null);
            onTurnOff3d();
          }}
          onDismiss={() => setSlow(null)}
        />
      )}
    </div>
  );
}

function SectionTab() {
  const box = useRef<HTMLDivElement>(null);
  const size = useElementSize(box);
  // the diagram's height follows its width, so pick the width that fits the tab both ways
  const aspect = useLathe((s) => {
    const b = sectionBounds(s.state);
    return (2 * b.rMax) / (b.zMax - b.zMin);
  });
  return (
    <div ref={box} className={styles.sectionTab}>
      <SectionView width={fitWidth(size, aspect)} />
    </div>
  );
}

function BottomTabs() {
  const mode = useLathe((s) => s.mode);
  const [tab, setTab] = useState<TabId>('project');
  // starting a lesson or challenge (or going home) brings the project panel to the front
  const [seenMode, setSeenMode] = useState(mode);
  if (seenMode !== mode) {
    setSeenMode(mode);
    setTab('project');
  }
  // ...scrolled to the top, so a new lesson's instructions are not left above the fold
  const projectPanel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (projectPanel.current) projectPanel.current.scrollTop = 0;
  }, [mode]);
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({ project: null, section: null, log: null });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length].id;
    setTab(next);
    tabRefs.current[next]?.focus();
    e.preventDefault();
  };

  return (
    <section className={styles.bottom} aria-label="Project, section view and log">
      <div className={styles.tabs} role="tablist" aria-label="Bottom panel" onKeyDown={onKeyDown}>
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={`${styles.tab} ${tab === t.id ? styles.tabActive : ''}`}
            data-testid={`tab-${t.id}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {/* the project panel stays mounted: do-it-yourself lessons keep their step in component state */}
      <div
        ref={projectPanel}
        role="tabpanel"
        id="panel-project"
        aria-labelledby="tab-project"
        className={styles.tabPanel}
        hidden={tab !== 'project'}
      >
        <ProjectTab />
      </div>
      {tab === 'section' && (
        <div role="tabpanel" id="panel-section" aria-labelledby="tab-section" className={styles.tabPanel}>
          <SectionTab />
        </div>
      )}
      {tab === 'log' && (
        <div role="tabpanel" id="panel-log" aria-labelledby="tab-log" className={`${styles.tabPanel} ${styles.padded}`}>
          <EventLog />
        </div>
      )}
    </section>
  );
}

function Controls() {
  const mode = useLathe((s) => s.mode);
  const demo = useLathe((s) => s.demo);
  const locked = useLathe(selectControlsLocked);
  const takeOver = useLathe((s) => s.takeOver);
  return (
    <div className={styles.side}>
      {locked && (
        <div className={styles.locked} data-testid="controls-locked" role="status">
          <span>{lockedMessage(mode, demo)}</span>
          <button type="button" className={styles.lockedButton} data-testid="controls-take-over" onClick={() => takeOver()}>
            {demo ? 'Stop the demo' : 'Take over'}
          </button>
        </div>
      )}
      <ControlPanel disabled={locked} className={styles.controlPanel} />
    </div>
  );
}

export default function App() {
  const mode = useLathe((s) => s.mode);
  const reset = useLathe((s) => s.reset);
  const no3d = useNo3dSetting();
  const [sceneDown, setSceneDown] = useState(false);
  const onSceneDown = useCallback(() => setSceneDown(true), []);
  // turning 3D off and on again remounts the scene: give it a fresh chance (and never run the
  // fallback ticker alongside a working scene, which would tick the sim twice per frame)
  const [seenOff, setSeenOff] = useState(no3d.off);
  if (seenOff !== no3d.off) {
    setSeenOff(no3d.off);
    setSceneDown(false);
  }

  // with no 3D scene there is no useFrame, so the shell drives the simulation
  useFallbackTicker(no3d.off || sceneDown);

  useEffect(() => {
    exposeDevHandle();
  }, []);

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <h1 className={styles.brand}>
          <img src={logo} alt="Lathe Sim" className={styles.logo} />
        </h1>
        <span className={styles.badge} data-testid="mode-badge" data-mode={mode.kind}>
          {modeLabel(mode)}
        </span>
        <div className={styles.spacer} />
        <CameraButtons />
        <button
          type="button"
          className={styles.headerButton}
          data-testid="app-home"
          title="Back to free play with a fresh machine"
          onClick={() => reset()}
        >
          Reset / Home
        </button>
        <HelpMenu />
        <SettingsMenu no3d={no3d} />
      </header>
      <main className={styles.main}>
        <div className={styles.work}>
          <Viewport off={no3d.off} onSceneDown={onSceneDown} onTurnOff3d={() => no3d.setSaved(true)} />
          <BottomTabs />
        </div>
        <Controls />
      </main>
    </div>
  );
}
