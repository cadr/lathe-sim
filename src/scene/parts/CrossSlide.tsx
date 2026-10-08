// Cross slide: rides on the saddle along scene Z (machine x). Its handwheel turns
// with x / pitch. Local origin = toolpost slot-floor centre (set by the Carriage).
import { forwardRef } from 'react';
import { RoundedBox } from '@react-three/drei';
import type * as THREE from 'three';
import type { ToolId } from '../../engine';
import { machineMaterials } from '../materials';
import { COMPOUND_TOP, Compound } from './Compound';
import { Handwheel3D } from './Handwheel3D';

/** Cross-slide body relative to the slot floor. */
export const CROSS_TOP = COMPOUND_TOP - 0.5 - 0.16;
export const CROSS_H = 0.6;
const Z0 = -3.6;
const Z1 = 2.4;

export interface CrossSlideProps {
  tool: ToolId;
  wheelRef: React.Ref<THREE.Group>;
}

export const CrossSlide = forwardRef<THREE.Group, CrossSlideProps>(function CrossSlide({ tool, wheelRef }, ref) {
  const m = machineMaterials();
  const y = CROSS_TOP - CROSS_H / 2;
  return (
    <group ref={ref}>
      <RoundedBox args={[2.5, CROSS_H, Z1 - Z0]} radius={0.06} smoothness={2} material={m.paintGreen} position={[0, y, (Z0 + Z1) / 2]} castShadow receiveShadow />
      {/* T-slots on the top */}
      {[-0.6, 0.6].map((x) => (
        <mesh key={x} material={m.hole} position={[x, CROSS_TOP + 0.003, (Z0 + Z1) / 2 - 0.9]}>
          <boxGeometry args={[0.18, 0.01, Z1 - Z0 - 2.2]} />
        </mesh>
      ))}
      {/* gib adjusting screws along the side */}
      {[-2.6, -1.2, 0.2, 1.6].map((z) => (
        <mesh key={z} material={m.blackOxide} position={[1.27, y, z]} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.06, 0.06, 0.05, 6]} />
        </mesh>
      ))}
      {/* screw bracket and handwheel at the operator end */}
      <mesh material={m.paintGreen} position={[0, y, Z1 + 0.15]} castShadow>
        <boxGeometry args={[1.2, CROSS_H + 0.1, 0.3]} />
      </mesh>
      <group position={[0, y, Z1 + 0.25]} scale={0.7}>
        <Handwheel3D ref={wheelRef} radius={1.05} spokes={3} />
      </group>
      <Compound tool={tool} />
    </group>
  );
});
