// Tailstock: body on the ways at tailstockZ, the quill extended by state.quill, the
// rear handwheel (rotates with quill / pitch) and the mounted tailstock tool.
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import type * as THREE from 'three';
import { MACHINE } from '../../engine';
import { useLathe } from '../../store';
import { BED_WIDTH, WAYS_TOP_Y, handwheelAngles, quillFaceX } from '../helpers';
import { machineMaterials } from '../materials';
import { Handwheel3D } from './Handwheel3D';
import { TailstockTool } from './TailstockTool';

const QUILL_R = MACHINE.quillRadius;
/** quill length visible beyond the body when fully retracted */
const NOSE = 0.3;
const BODY_LEN = 3.6;
const QUILL_LEN = BODY_LEN + 0.2;

export function Tailstock() {
  const m = machineMaterials();
  const tool = useLathe((s) => s.state.tailstockTool);
  const tailstockZ = useLathe((s) => s.state.tailstockZ);
  const quill = useRef<THREE.Group>(null);
  const wheel = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Group>(null);

  useFrame(() => {
    const s = useLathe.getState().state;
    if (quill.current) quill.current.position.x = quillFaceX(s.tailstockZ, s.quill) - s.tailstockZ;
    // wheel faces +X (the operator stands at the right end): clockwise = −rotation about X
    if (wheel.current) wheel.current.rotation.z = -handwheelAngles(s).quill;
    if (spin.current) spin.current.rotation.x = s.spindle.angle;
  });

  const bodyX0 = NOSE; // relative to tailstockZ
  const baseY = WAYS_TOP_Y + 0.35;
  const upperH = -WAYS_TOP_Y - 0.7 + 0.9;
  return (
    <group position-x={tailstockZ}>
      {/* base on the ways */}
      <RoundedBox args={[BODY_LEN + 0.4, 0.7, BED_WIDTH + 0.5]} radius={0.1} smoothness={2} material={m.paintGreen} position={[bodyX0 + BODY_LEN / 2 + 0.2, baseY, 0]} castShadow receiveShadow />
      {/* upper body */}
      <RoundedBox args={[BODY_LEN - 0.2, upperH, 1.9]} radius={0.2} smoothness={3} material={m.paintGreen} position={[bodyX0 + BODY_LEN / 2 + 0.2, WAYS_TOP_Y + 0.7 + upperH / 2, 0]} castShadow receiveShadow />
      {/* quill barrel */}
      <mesh material={m.paintGreen} position-x={bodyX0 + BODY_LEN / 2} rotation-z={Math.PI / 2} castShadow>
        <cylinderGeometry args={[0.95, 0.95, BODY_LEN, 40]} />
      </mesh>
      {/* clamp lever on the base and quill lock on top */}
      <group position={[bodyX0 + BODY_LEN - 0.4, baseY + 0.1, BED_WIDTH / 2 + 0.25]} rotation-x={0.9}>
        <mesh material={m.steel} position-y={0.45}>
          <cylinderGeometry args={[0.06, 0.06, 0.9, 10]} />
        </mesh>
        <mesh material={m.paintRed} position-y={0.95} castShadow>
          <sphereGeometry args={[0.15, 16, 12]} />
        </mesh>
      </group>
      <group position={[bodyX0 + 0.7, 0.95, 0]} rotation-x={-0.6}>
        <mesh material={m.steel} position-y={0.3}>
          <cylinderGeometry args={[0.05, 0.05, 0.6, 10]} />
        </mesh>
        <mesh material={m.paintRed} position-y={0.65} castShadow>
          <sphereGeometry args={[0.12, 16, 12]} />
        </mesh>
      </group>
      {/* rear handwheel, facing +X */}
      <group position-x={bodyX0 + BODY_LEN + 0.05} rotation-y={Math.PI / 2}>
        <Handwheel3D ref={wheel} radius={1.25} spokes={3} />
      </group>
      {/* quill: local origin follows the quill face (x = −quill relative to tailstockZ) */}
      <group ref={quill}>
        <mesh material={m.ground} position-x={QUILL_LEN / 2} rotation-z={Math.PI / 2} castShadow>
          <cylinderGeometry args={[QUILL_R, QUILL_R, QUILL_LEN, 32]} />
        </mesh>
        {/* graduations along the quill */}
        {[0.5, 1.0, 1.5, 2.0].map((x) => (
          <mesh key={x} material={m.blackOxide} position={[x, QUILL_R + 0.001, 0]}>
            <boxGeometry args={[0.02, 0.01, 0.18]} />
          </mesh>
        ))}
        <TailstockTool ref={spin} tool={tool} />
      </group>
    </group>
  );
}
