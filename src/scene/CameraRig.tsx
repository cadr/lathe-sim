// OrbitControls whose camera and target glide (exponential lerp) to the store's camera preset.
// Dragging hands control to the user (free orbit) until a preset is chosen again (re-choosing
// the current one counts). The 'tool' preset keeps following the tool tip: while gliding the
// goal moves with the tip, and in free orbit the user's view is carried along with it.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { useLathe } from '../store';
import { CAMERA_PRESETS, cameraPresetFor } from './helpers';

const SPEED = 3.5; // 1/s
const SETTLED = 1e-4;

export function CameraRig() {
  const preset = useLathe((s) => s.camera);
  const nonce = useLathe((s) => s.cameraNonce);
  const controls = useRef<OrbitControlsImpl>(null);
  const animating = useRef(true);
  const lastTip = useRef<{ x: number; z: number } | null>(null);
  const tmp = useMemo(() => ({ pos: new THREE.Vector3(), target: new THREE.Vector3() }), []);

  useEffect(() => {
    animating.current = true;
  }, [preset, nonce]);

  useFrame((state, dt) => {
    const c = controls.current;
    if (!c) return;
    const following = preset === 'tool';
    const s = useLathe.getState().state;
    if (following) {
      const prev = lastTip.current;
      // free orbit: carry the user's view along with the tool (scene X = machine z, Z = x)
      if (!animating.current && prev && (prev.x !== s.x || prev.z !== s.z)) {
        const dx = s.z - prev.z;
        const dz = Math.max(0, s.x) - Math.max(0, prev.x);
        state.camera.position.x += dx;
        state.camera.position.z += dz;
        c.target.x += dx;
        c.target.z += dz;
        c.update();
      }
      if (prev) {
        prev.x = s.x;
        prev.z = s.z;
      } else lastTip.current = { x: s.x, z: s.z };
    } else lastTip.current = null;
    if (!animating.current) return;
    const p = cameraPresetFor(preset, following ? s : undefined);
    tmp.pos.set(p.position[0], p.position[1], p.position[2]);
    tmp.target.set(p.target[0], p.target[1], p.target[2]);
    const k = 1 - Math.exp(-SPEED * Math.min(dt, 0.1));
    state.camera.position.lerp(tmp.pos, k);
    c.target.lerp(tmp.target, k);
    c.update();
    // once settled, stop gliding; the tool view then follows the tip by carrying the view along
    if (state.camera.position.distanceToSquared(tmp.pos) < SETTLED && c.target.distanceToSquared(tmp.target) < SETTLED) {
      state.camera.position.copy(tmp.pos);
      c.target.copy(tmp.target);
      c.update();
      animating.current = false;
    }
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      minDistance={1.5}
      maxDistance={40}
      maxPolarAngle={Math.PI * 0.55}
      target={CAMERA_PRESETS.overview.target}
      onStart={() => {
        animating.current = false;
      }}
    />
  );
}
