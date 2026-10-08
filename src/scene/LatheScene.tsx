// The 3D lathe: Canvas, lights, environment, camera rig, machine parts, work and chips.
import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { useLathe } from '../store';
import { CAMERA_PRESETS, MAX_FRAME_DT } from './helpers';
import { CameraRig } from './CameraRig';
import { Chips } from './Chips';
import { SceneErrorBoundary, SceneFallback } from './SceneErrorBoundary';
import { Workpiece } from './Workpiece';
import { webglAvailable } from './webgl';
import { installThreeConsoleFilter } from './threeConsole';

installThreeConsoleFilter();

export { webglAvailable };
import { Bed } from './parts/Bed';
import { Carriage } from './parts/Carriage';
import { ChipTray } from './parts/ChipTray';
import { Chuck } from './parts/Chuck';
import { Headstock } from './parts/Headstock';
import { Tailstock } from './parts/Tailstock';

const BG = '#1c2024';

/** The single frame loop that advances the simulation (engine + script player). */
function Ticker() {
  useFrame((_, dt) => {
    useLathe.getState().tick(Math.min(dt, MAX_FRAME_DT));
  });
  return null;
}

/** Frame rate below which the app suggests turning the 3D view off. */
export const SLOW_FPS = 20;
const WARMUP_S = 2;
const WINDOW_S = 4;

/**
 * Average frame rate over a window after a warm-up: below SLOW_FPS (software rendering, an old
 * GPU) it reports once, so the app can suggest the no-3D mode.
 */
export function slowFrameRate(frameDts: number[], warmup = WARMUP_S, window = WINDOW_S): number | null {
  let t = 0;
  let frames = 0;
  let span = 0;
  for (const dt of frameDts) {
    t += dt;
    if (t <= warmup) continue;
    frames++;
    span += dt;
    if (span >= window) {
      const fps = frames / span;
      return fps < SLOW_FPS ? fps : null;
    }
  }
  return null;
}

function FrameWatch({ onSlow }: { onSlow: (fps: number) => void }) {
  const dts = useRef<number[]>([]);
  const total = useRef(0);
  const done = useRef(false);
  useFrame((_, dt) => {
    if (done.current) return;
    dts.current.push(dt);
    total.current += dt;
    if (total.current < WARMUP_S + WINDOW_S) return;
    done.current = true;
    const fps = slowFrameRate(dts.current);
    dts.current = [];
    if (fps !== null) onSlow(fps);
  });
  return null;
}

/**
 * Shop lighting baked into an environment map from local light panels: no HDR
 * download, so it works offline and in headless test browsers.
 */
function ShopEnvironment() {
  return (
    <Environment resolution={256} frames={1}>
      <color attach="background" args={['#4a5058']} />
      {/* overhead fluorescent strips */}
      {[-6, 0, 6].map((x) => (
        <Lightformer key={x} form="rect" intensity={3} color="#f3f6ff" position={[x, 9, 2]} rotation-x={Math.PI / 2} scale={[1.2, 14, 1]} />
      ))}
      {/* window light from the front-left, warm bounce from the bench */}
      <Lightformer form="rect" intensity={1.6} color="#dfe9ff" position={[-12, 4, 10]} rotation-y={Math.PI / 4} scale={[10, 6, 1]} />
      <Lightformer form="rect" intensity={0.3} color="#f0e2cf" position={[0, -6, 8]} rotation-x={-Math.PI / 3} scale={[30, 4, 1]} />
      <Lightformer form="ring" intensity={1.2} color="#ffffff" position={[10, 5, -6]} scale={4} />
      {/* bright shop wall behind the operator and a softbox to the right */}
      <Lightformer form="rect" intensity={1.0} color="#e8ecf2" position={[0, 2, 18]} scale={[40, 8, 1]} />
      <Lightformer form="rect" intensity={1.4} color="#ffffff" position={[16, 3, 2]} rotation-y={-Math.PI / 2} scale={[8, 5, 1]} />
    </Environment>
  );
}

function Lights() {
  return (
    <>
      <hemisphereLight args={['#dde6f0', '#3b3128', 0.9]} />
      <spotLight
        position={[4, 16, 12]}
        angle={0.55}
        penumbra={0.7}
        intensity={1400}
        decay={2}
        color="#fff4e6"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      <directionalLight position={[-10, 6, 8]} intensity={1.1} color="#cfe0ff" />
      <pointLight position={[2, 2.5, 4]} intensity={6} distance={10} decay={2} color="#fff1dc" />
    </>
  );
}

function Machine() {
  return (
    <group>
      <Bed />
      <Headstock />
      <Chuck />
      <Carriage />
      <Tailstock />
      <ChipTray />
      <Workpiece />
      <Chips />
    </group>
  );
}

export function SceneContents({ onSlow }: { onSlow?: (fps: number) => void }) {
  return (
    <>
      <color attach="background" args={[BG]} />
      <fog attach="fog" args={[BG, 30, 70]} />
      <Ticker />
      {onSlow && <FrameWatch onSlow={onSlow} />}
      <Lights />
      <SceneErrorBoundary silent>
        <Suspense fallback={null}>
          <ShopEnvironment />
        </Suspense>
      </SceneErrorBoundary>
      <Machine />
      <CameraRig />
    </>
  );
}

export interface LatheSceneProps {
  className?: string;
  style?: React.CSSProperties;
  /**
   * Called once when the 3D view can't run (no WebGL, or the Canvas threw). The app uses it to
   * start its fallback ticker, because the scene's frame loop is what normally drives the sim.
   */
  onUnavailable?: () => void;
  /** Called once if the scene renders slower than SLOW_FPS (after a short warm-up). */
  onSlow?: (fps: number) => void;
}

export function LatheScene({ className, style, onUnavailable, onSlow }: LatheSceneProps) {
  // probe once per mount
  const [gl] = useState(webglAvailable);
  useEffect(() => {
    if (!gl) onUnavailable?.();
  }, [gl, onUnavailable]);
  return (
    <div data-testid="lathe-canvas" className={className} style={{ position: 'relative', width: '100%', height: '100%', ...style }}>
      <SceneErrorBoundary onError={onUnavailable}>
        {!gl ? (
          <SceneFallback />
        ) : (
          <Canvas
            shadows="percentage"
            dpr={[1, 2]}
            gl={{ antialias: true, preserveDrawingBuffer: false }}
            camera={{ position: CAMERA_PRESETS.overview.position, fov: 40, near: 0.1, far: 200 }}
          >
            <Suspense fallback={null}>
              <SceneContents onSlow={onSlow} />
            </Suspense>
          </Canvas>
        )}
      </SceneErrorBoundary>
    </div>
  );
}
