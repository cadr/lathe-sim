// Compound slide (set over 30°) and the 4-way toolpost holding the tool.
// Local origin = toolpost slot floor centre; the tool is placed at toolTipOffset(tool).
import type { ToolId } from '../../engine';
import { toolTipOffset } from '../helpers';
import { machineMaterials } from '../materials';
import { Handwheel3D } from './Handwheel3D';
import { ToolMesh } from './ToolMesh';

const SLOT = 0.39;
const CAP = 0.3;
const BLOCK = 1.5;
const CORE = 0.75;
const BOLT_IN = (BLOCK + CORE) / 4;
const BOLTS: [number, number][] = [
  [-BOLT_IN, -0.38],
  [-BOLT_IN, 0.38],
  [BOLT_IN, -0.38],
  [BOLT_IN, 0.38],
  [-0.38, BOLT_IN],
  [0.38, BOLT_IN],
  [-0.38, -BOLT_IN],
  [0.38, -BOLT_IN],
];
/** Compound top relative to the slot floor. */
export const COMPOUND_TOP = -0.575;

export function Compound({ tool }: { tool: ToolId }) {
  const m = machineMaterials();
  const tip = toolTipOffset(tool);
  return (
    <group>
      {/* compound: swivel base, slide and its small handwheel, set over 30° */}
      <mesh material={m.paintGreen} position-y={COMPOUND_TOP - 0.5 - 0.08} castShadow>
        <cylinderGeometry args={[1.05, 1.05, 0.16, 40]} />
      </mesh>
      <group rotation-y={-Math.PI / 6}>
        <mesh material={m.paintGreen} position={[0, COMPOUND_TOP - 0.25, 0.25]} castShadow receiveShadow>
          <boxGeometry args={[1.7, 0.5, 3.0]} />
        </mesh>
        <mesh material={m.ground} position={[0, COMPOUND_TOP - 0.02, 0.25]}>
          <boxGeometry args={[1.5, 0.04, 2.6]} />
        </mesh>
        <mesh material={m.steel} position={[0, COMPOUND_TOP - 0.25, 2.0]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.07, 0.07, 0.5, 10]} />
        </mesh>
        <group position={[0, COMPOUND_TOP - 0.25, 1.95]} scale={0.45}>
          <Handwheel3D radius={1.0} spokes={2} />
        </group>
      </group>
      {/* 4-way toolpost: base, a core with an open slot on every side, top cap */}
      <mesh material={m.blackOxide} position-y={COMPOUND_TOP / 2} castShadow receiveShadow>
        <boxGeometry args={[BLOCK, -COMPOUND_TOP, BLOCK]} />
      </mesh>
      <mesh material={m.blackOxide} position-y={SLOT / 2} castShadow>
        <boxGeometry args={[CORE, SLOT, CORE]} />
      </mesh>
      <mesh material={m.blackOxide} position-y={SLOT + CAP / 2} castShadow>
        <boxGeometry args={[BLOCK, CAP, BLOCK]} />
      </mesh>
      {/* clamp bolts: two over each slot */}
      {BOLTS.map(([x, z]) => (
        <mesh key={`${x}${z}`} material={m.steel} position={[x, SLOT + CAP + 0.07, z]} castShadow>
          <cylinderGeometry args={[0.1, 0.1, 0.14, 6]} />
        </mesh>
      ))}
      {/* clamp handle, pointing away from the work */}
      <mesh material={m.steel} position-y={SLOT + CAP + 0.2}>
        <cylinderGeometry args={[0.13, 0.16, 0.4, 16]} />
      </mesh>
      <group position-y={SLOT + CAP + 0.34} rotation-y={-0.8}>
        <mesh material={m.steel} position-x={0.45} rotation-z={Math.PI / 2 - 0.15}>
          <cylinderGeometry args={[0.045, 0.045, 0.9, 10]} />
        </mesh>
        <mesh material={m.paintRed} position={[0.9, 0.07, 0]} castShadow>
          <sphereGeometry args={[0.12, 16, 12]} />
        </mesh>
      </group>
      <group position={tip}>
        <ToolMesh tool={tool} />
      </group>
    </group>
  );
}
