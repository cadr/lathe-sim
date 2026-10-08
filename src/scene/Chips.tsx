// Instanced chip particles: small flat flakes thrown from the cutting point while
// state.cutting is true. Fixed pool of MAX_CHIPS, recycled oldest-first; chips that
// land rest in the chip tray until reused. No allocation per frame.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { TAILSTOCK_TOOLS, facePosition, tailstockTipZ } from '../engine';
import { useLathe } from '../store';
import { CHIP_COLORS, CHIP_TRAY_Y, MAX_CHIPS, chipSpawnCount } from './helpers';

const GRAVITY = -70;

interface ChipSim {
  pos: Float32Array;
  vel: Float32Array;
  rot: Float32Array;
  spin: Float32Array;
  /** 0 hidden, 1 flying, 2 resting in the tray */
  alive: Uint8Array;
  next: number;
  carry: { value: number };
  dummy: THREE.Object3D;
  color: THREE.Color;
}

function createSim(): ChipSim {
  return {
    pos: new Float32Array(MAX_CHIPS * 3),
    vel: new Float32Array(MAX_CHIPS * 3),
    rot: new Float32Array(MAX_CHIPS * 3),
    spin: new Float32Array(MAX_CHIPS * 3),
    alive: new Uint8Array(MAX_CHIPS),
    next: 0,
    carry: { value: 0 },
    dummy: new THREE.Object3D(),
    color: new THREE.Color(),
  };
}

export function Chips() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => new THREE.BoxGeometry(0.11, 0.01, 0.045), []);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ metalness: 0.8, roughness: 0.35 }), []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  const simRef = useRef<ChipSim | null>(null);

  // hide every instance and allocate instance colours before the first frame,
  // so the shader is compiled with per-instance colour from the start
  useLayoutEffect(() => {
    const im = mesh.current;
    if (!im) return;
    const sim = (simRef.current ??= createSim());
    const { dummy } = sim;
    dummy.scale.set(0, 0, 0);
    dummy.updateMatrix();
    sim.color.set(CHIP_COLORS.brass);
    for (let i = 0; i < MAX_CHIPS; i++) {
      im.setMatrixAt(i, dummy.matrix);
      im.setColorAt(i, sim.color);
    }
    dummy.scale.set(1, 1, 1);
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }, []);

  useFrame((_, rawDt) => {
    const im = mesh.current;
    if (!im) return;
    const dt = Math.min(rawDt, 0.05);
    const sim = (simRef.current ??= createSim());
    const { pos, vel, rot, spin, alive, dummy } = sim;
    const s = useLathe.getState().state;
    let dirty = false;

    if (s.cutting && s.spindle.on && s.workpiece) {
      const n = chipSpawnCount(dt, s.spindle.rpm, sim.carry);
      // cutting point: the drill tip when a drill is in the work, else the toolpost tool tip
      const face = facePosition(s.workpiece);
      const drillTip = tailstockTipZ(s.tailstockTool, s.tailstockZ, s.quill);
      const drilling = TAILSTOCK_TOOLS[s.tailstockTool].cuts && face !== null && drillTip <= face + 0.01;
      const ox = drilling ? (face ?? 0) : s.z;
      const oz = drilling ? 0 : Math.max(0, s.x);
      sim.color.set(CHIP_COLORS[s.workpiece.material]);
      for (let k = 0; k < n; k++) {
        const i = sim.next;
        sim.next = (sim.next + 1) % MAX_CHIPS;
        const j = i * 3;
        pos[j] = ox + Math.random() * 0.05;
        pos[j + 1] = Math.random() * 0.05;
        pos[j + 2] = oz;
        if (drilling) {
          // chips spiral out of the hole toward the tailstock
          const a = Math.random() * Math.PI * 2;
          vel[j] = 4 + Math.random() * 6;
          vel[j + 1] = Math.cos(a) * 8;
          vel[j + 2] = Math.sin(a) * 8;
        } else {
          // the work turns toward the operator at the top: chips fly up and out
          vel[j] = (Math.random() - 0.5) * 4;
          vel[j + 1] = 4 + Math.random() * 8;
          vel[j + 2] = 3 + Math.random() * 7;
        }
        rot[j] = Math.random() * 6;
        rot[j + 1] = Math.random() * 6;
        rot[j + 2] = Math.random() * 6;
        spin[j] = (Math.random() - 0.5) * 40;
        spin[j + 1] = (Math.random() - 0.5) * 40;
        spin[j + 2] = (Math.random() - 0.5) * 40;
        alive[i] = 1;
        im.setColorAt(i, sim.color);
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
    }

    for (let i = 0; i < MAX_CHIPS; i++) {
      if (alive[i] !== 1) continue;
      const j = i * 3;
      vel[j + 1] += GRAVITY * dt;
      pos[j] += vel[j] * dt;
      pos[j + 1] += vel[j + 1] * dt;
      pos[j + 2] += vel[j + 2] * dt;
      rot[j] += spin[j] * dt;
      rot[j + 1] += spin[j + 1] * dt;
      rot[j + 2] += spin[j + 2] * dt;
      if (pos[j + 1] <= CHIP_TRAY_Y + 0.01) {
        pos[j + 1] = CHIP_TRAY_Y + 0.01;
        rot[j] = 0;
        rot[j + 2] = 0;
        alive[i] = 2;
      }
      // keep inside the tray
      if (pos[j + 2] > 5) {
        pos[j + 2] = 5;
        vel[j + 2] *= -0.3;
      }
      dummy.position.set(pos[j], pos[j + 1], pos[j + 2]);
      dummy.rotation.set(rot[j], rot[j + 1], rot[j + 2]);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
      dirty = true;
    }
    if (dirty) im.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[geometry, material, MAX_CHIPS]} frustumCulled={false} castShadow />;
}
