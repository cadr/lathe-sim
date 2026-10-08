// 3-jaw scroll chuck on the spindle nose. Jaws occupy z ∈ [−0.6, 0] and close on
// the stock radius. The whole chuck spins with state.spindle.angle.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import { MACHINE } from '../../engine';
import { useLathe } from '../../store';
import { CHUCK_BODY_LENGTH, CHUCK_BODY_RADIUS, jawRadius } from '../helpers';
import { machineMaterials } from '../materials';
import { HEADSTOCK_FACE_X } from './Headstock';

const JAW_L = MACHINE.chuckJawLength;
const BODY_X = -JAW_L - CHUCK_BODY_LENGTH / 2;
const JAW_W = 0.42;
const CHAMFER = 0.08;

function Jaw({ angle, radius }: { angle: number; radius: number }) {
  const m = machineMaterials();
  // stepped jaw: the gripping step is full length, the outer steps get shorter
  const steps = [
    { r0: 0, r1: 0.32, len: JAW_L },
    { r0: 0.32, r1: 0.58, len: JAW_L * 0.66 },
    { r0: 0.58, r1: 0.84, len: JAW_L * 0.36 },
  ];
  return (
    <group rotation-x={angle}>
      {steps.map((s) => (
        <mesh
          key={s.r0}
          material={m.chuckFace}
          position={[-JAW_L + s.len / 2, radius + (s.r0 + s.r1) / 2, 0]}
          castShadow
        >
          <boxGeometry args={[s.len, s.r1 - s.r0, JAW_W]} />
        </mesh>
      ))}
    </group>
  );
}

export function Chuck() {
  const m = machineMaterials();
  const spin = useRef<THREE.Group>(null);
  const version = useLathe((s) => s.version);
  const radius = useMemo(() => {
    void version;
    return jawRadius(useLathe.getState().state);
  }, [version]);

  useFrame(() => {
    if (spin.current) spin.current.rotation.x = useLathe.getState().state.spindle.angle;
  });

  const backLen = -JAW_L - CHUCK_BODY_LENGTH - HEADSTOCK_FACE_X;
  return (
    <group ref={spin}>
      {/* chuck body */}
      <mesh material={m.steel} position-x={BODY_X - CHAMFER / 2} rotation-z={Math.PI / 2} castShadow receiveShadow>
        <cylinderGeometry args={[CHUCK_BODY_RADIUS, CHUCK_BODY_RADIUS, CHUCK_BODY_LENGTH - CHAMFER, 64]} />
      </mesh>
      {/* chamfered front edge (cylinder +Y maps to −X here, so the top radius is the back) */}
      <mesh material={m.steel} position-x={-JAW_L - CHAMFER / 2} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[CHUCK_BODY_RADIUS, CHUCK_BODY_RADIUS - CHAMFER, CHAMFER, 64]} />
      </mesh>
      {/* machined front face */}
      <mesh material={m.chuckFace} position-x={-JAW_L + 0.004} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[CHUCK_BODY_RADIUS - CHAMFER, CHUCK_BODY_RADIUS - CHAMFER, 0.008, 64]} />
      </mesh>
      {/* centre bore */}
      <mesh material={m.hole} position-x={-JAW_L + 0.006} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.42, 0.42, 0.012, 32]} />
      </mesh>
      {/* jaw slots and key sockets */}
      {[0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2;
        const ka = a + Math.PI / 3;
        return (
          <group key={i}>
            <group rotation-x={a}>
              <mesh material={m.hole} position={[-JAW_L + 0.0055, (CHUCK_BODY_RADIUS - CHAMFER + 0.42) / 2, 0]}>
                <boxGeometry args={[0.011, CHUCK_BODY_RADIUS - CHAMFER - 0.42, JAW_W + 0.06]} />
              </mesh>
            </group>
            <group rotation-x={ka}>
              <mesh material={m.hole} position={[BODY_X + 0.25, CHUCK_BODY_RADIUS - 0.005, 0]}>
                <cylinderGeometry args={[0.12, 0.12, 0.04, 12]} />
              </mesh>
            </group>
            <Jaw angle={a} radius={radius} />
          </group>
        );
      })}
      {/* backplate and spindle nose */}
      <mesh material={m.darkSteel} position-x={HEADSTOCK_FACE_X + backLen / 2} rotation-z={Math.PI / 2} castShadow>
        <cylinderGeometry args={[1.25, 1.1, backLen, 48]} />
      </mesh>
    </group>
  );
}
