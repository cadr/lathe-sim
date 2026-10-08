// Carriage: saddle on the ways (moves with machine z), apron with the carriage
// handwheel, and the cross slide / compound / toolpost / tool stack (moves with x).
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import type * as THREE from 'three';
import { useLathe } from '../../store';
import { BED_WIDTH, WAYS_TOP_Y, handwheelAngles, toolpostPosition } from '../helpers';
import { machineMaterials } from '../materials';
import { CROSS_H, CROSS_TOP, CrossSlide } from './CrossSlide';
import { Handwheel3D } from './Handwheel3D';

export function Carriage() {
  const m = machineMaterials();
  const tool = useLathe((s) => s.state.tool);
  const carriage = useRef<THREE.Group>(null);
  const cross = useRef<THREE.Group>(null);
  const zWheel = useRef<THREE.Group>(null);
  const xWheel = useRef<THREE.Group>(null);

  useFrame(() => {
    const s = useLathe.getState().state;
    const [px, py, pz] = toolpostPosition(s.tool, s.x, s.z);
    if (carriage.current) carriage.current.position.set(px, 0, 0);
    if (cross.current) cross.current.position.set(0, py, pz);
    const a = handwheelAngles(s);
    // wheels face the operator (+Z): clockwise as seen from the front is −rotation about Z
    if (zWheel.current) zWheel.current.rotation.z = -a.z;
    if (xWheel.current) xWheel.current.rotation.z = -a.x;
  });

  // saddle top sits under the cross slide; the slot floor is at y = −0.375
  const saddleTop = -0.375 + CROSS_TOP - CROSS_H;
  const saddleH = saddleTop - WAYS_TOP_Y;
  const apronZ = BED_WIDTH / 2 + 0.95;
  return (
    <group ref={carriage}>
      {/* saddle: wings over both ways and a raised dovetail for the cross slide */}
      <RoundedBox args={[4.8, 0.6, BED_WIDTH + 1.4]} radius={0.08} smoothness={2} material={m.paintGreen} position={[0, WAYS_TOP_Y + 0.3, 0.2]} castShadow receiveShadow />
      <RoundedBox args={[2.9, saddleH - 0.6, BED_WIDTH + 1.0]} radius={0.08} smoothness={2} material={m.paintGreen} position={[0, WAYS_TOP_Y + 0.6 + (saddleH - 0.6) / 2, 0.4]} castShadow receiveShadow />
      {/* way wipers */}
      {[-2.42, 2.42].map((x) => (
        <mesh key={x} material={m.rubber} position={[x, WAYS_TOP_Y + 0.12, 0]}>
          <boxGeometry args={[0.05, 0.25, BED_WIDTH + 0.2]} />
        </mesh>
      ))}
      {/* apron hanging in front of the bed */}
      <RoundedBox args={[5.0, 3.0, 0.5]} radius={0.12} smoothness={2} material={m.paintGreen} position={[-0.5, WAYS_TOP_Y - 1.2, apronZ]} castShadow receiveShadow />
      <group position={[-1.75, WAYS_TOP_Y - 1.5, apronZ + 0.25]}>
        <Handwheel3D ref={zWheel} radius={1.15} spokes={3} />
      </group>
      {/* half-nut lever */}
      <group position={[1.2, WAYS_TOP_Y - 1.9, apronZ + 0.25]} rotation-z={0.5}>
        <mesh material={m.steel} position-y={0.35}>
          <boxGeometry args={[0.12, 0.7, 0.12]} />
        </mesh>
        <mesh material={m.paintRed} position-y={0.75} castShadow>
          <sphereGeometry args={[0.16, 16, 12]} />
        </mesh>
      </group>
      {/* feed-direction knob */}
      <mesh material={m.blackOxide} position={[1.2, WAYS_TOP_Y - 0.6, apronZ + 0.3]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.2, 0.22, 0.2, 16]} />
      </mesh>
      <CrossSlide ref={cross} tool={tool} wheelRef={xWheel} />
    </group>
  );
}
