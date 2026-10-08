// A small cast handwheel: rim, spokes, hub, a chrome dial collar and a red handle.
// The wheel faces +Z of its group; the parent orients it and spins `wheelRef` about Z.
import { forwardRef } from 'react';
import type * as THREE from 'three';
import { machineMaterials } from '../materials';

export interface Handwheel3DProps {
  radius?: number;
  spokes?: number;
  /** show the graduated dial collar behind the wheel */
  collar?: boolean;
}

export const Handwheel3D = forwardRef<THREE.Group, Handwheel3DProps>(function Handwheel3D(
  { radius = 1.1, spokes = 3, collar = true },
  ref,
) {
  const m = machineMaterials();
  const tube = Math.max(0.06, radius * 0.08);
  return (
    <group>
      {collar && (
        <mesh material={m.chrome} rotation-x={Math.PI / 2} position-z={0.12} castShadow>
          <cylinderGeometry args={[0.42, 0.42, 0.3, 32]} />
        </mesh>
      )}
      <group ref={ref} position-z={0.4}>
        <mesh material={m.chrome} castShadow>
          <torusGeometry args={[radius, tube, 12, 48]} />
        </mesh>
        <mesh material={m.chrome} rotation-x={Math.PI / 2} castShadow>
          <cylinderGeometry args={[0.24, 0.28, 0.28, 24]} />
        </mesh>
        {Array.from({ length: spokes }, (_, i) => {
          const a = (i / spokes) * Math.PI * 2;
          return (
            <mesh key={i} material={m.chrome} rotation-z={a} position={[Math.cos(a + Math.PI / 2) * radius * 0.5, Math.sin(a + Math.PI / 2) * radius * 0.5, 0]} castShadow>
              <boxGeometry args={[tube * 1.3, radius, tube * 1.1]} />
            </mesh>
          );
        })}
        {/* handle on the rim */}
        <mesh material={m.chrome} position={[radius * 0.98, 0, 0.18]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.05, 0.05, 0.36, 10]} />
        </mesh>
        <mesh material={m.paintRed} position={[radius * 0.98, 0, 0.6]} rotation-x={Math.PI / 2} castShadow>
          <cylinderGeometry args={[0.11, 0.13, 0.6, 16]} />
        </mesh>
      </group>
    </group>
  );
});
