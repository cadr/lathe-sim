// Toolpost tool meshes. Each tool's local origin is its cutting tip; the tool body
// reaches back toward the operator (+Z) into the toolpost, matching the engine footprints:
//   turning: occupies machine z ∈ [z, z + 0.25] (scene +X from the tip)
//   parting: blade 0.0625 wide (scene X ∈ [0, 0.0625])
//   boring:  bar inside the tip radius, reaching toward the tailstock (+X)
import { useMemo } from 'react';
import * as THREE from 'three';
import type { ToolId } from '../../engine';
import { PARTING_BLADE_WIDTH, TURNING_TOOL_WIDTH } from '../../engine';
import { machineMaterials } from '../materials';

const SHANK = 0.375;

/** Extrudes an outline drawn in the scene XZ plane (y up), `thickness` tall from y0. */
function useXZPrism(outline: [number, number][], thickness: number): THREE.ExtrudeGeometry {
  return useMemo(() => {
    const shape = new THREE.Shape();
    outline.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, -z) : shape.lineTo(x, -z)));
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
    // shape (x, y) at depth d  →  rotate −90° about X  →  (x, d, −y) = (x, d, z)
    geo.rotateX(-Math.PI / 2);
    return geo;
    // outline is a module constant per tool
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thickness]);
}

const INSERT: [number, number][] = [
  [0, 0],
  [TURNING_TOOL_WIDTH + 0.08, 0.07],
  [0.2, 0.42],
];
const HEAD: [number, number][] = [
  [0.02, 0.05],
  [SHANK + 0.02, 0.1],
  [SHANK, 0.62],
  [0, 0.62],
];

function TurningTool() {
  const m = machineMaterials();
  const insert = useXZPrism(INSERT, 0.14);
  const head = useXZPrism(HEAD, SHANK - 0.14);
  return (
    <group>
      <mesh geometry={insert} material={m.carbide} position-y={-0.14} castShadow />
      <mesh geometry={head} material={m.darkSteel} position-y={-SHANK} castShadow />
      {/* insert clamp screw */}
      <mesh material={m.blackOxide} position={[0.17, 0.01, 0.2]}>
        <cylinderGeometry args={[0.05, 0.05, 0.04, 12]} />
      </mesh>
      <mesh material={m.darkSteel} position={[SHANK / 2, -SHANK / 2, 1.42]} castShadow>
        <boxGeometry args={[SHANK, SHANK, 1.6]} />
      </mesh>
    </group>
  );
}

/** How far the parting blade sticks out of its holder toward the work. */
export const PARTING_BLADE_REACH = 1.1;

function PartingTool() {
  const m = machineMaterials();
  const w = PARTING_BLADE_WIDTH;
  const len = 2.4;
  const h = 0.5;
  return (
    <group>
      {/* HSS blade, tip at origin, a little taller than the holder so its top edge shows */}
      <mesh material={m.blade} position={[w / 2, -h / 2, len / 2]} castShadow>
        <boxGeometry args={[w, h, len]} />
      </mesh>
      {/* ground tip: a slightly darker strip so the cutting edge reads in close-ups */}
      <mesh material={m.hss} position={[w / 2, -h / 2, 0.02]}>
        <boxGeometry args={[w + 0.004, h + 0.004, 0.04]} />
      </mesh>
      {/* blade holder on the chuck side of the blade, set well back from the work */}
      <mesh material={m.toolHolder} position={[-0.16, -0.21, PARTING_BLADE_REACH + 0.85]} castShadow>
        <boxGeometry args={[0.32, 0.36, 1.7]} />
      </mesh>
      {/* clamp screws along the holder */}
      {[0.35, 0.95].map((dz) => (
        <mesh key={dz} material={m.blackOxide} position={[-0.16, -0.02, PARTING_BLADE_REACH + dz]}>
          <cylinderGeometry args={[0.05, 0.05, 0.03, 10]} />
        </mesh>
      ))}
    </group>
  );
}

function BoringBar() {
  const m = machineMaterials();
  const r = 0.0625;
  return (
    <group>
      {/* cutting nub at the tip, bar running toward the tailstock inside the tip radius */}
      <mesh material={m.carbide} position={[0.04, -0.03, -0.03]} castShadow>
        <boxGeometry args={[0.08, 0.06, 0.07]} />
      </mesh>
      <mesh material={m.darkSteel} position={[0.85, -0.06, -r]} rotation-z={Math.PI / 2} castShadow>
        <cylinderGeometry args={[r, r, 1.7, 16]} />
      </mesh>
      {/* square shank clamped in the toolpost */}
      <mesh material={m.darkSteel} position={[1.7, -SHANK / 2, 0.72]} castShadow>
        <boxGeometry args={[SHANK, SHANK, 1.6]} />
      </mesh>
    </group>
  );
}

export function ToolMesh({ tool }: { tool: ToolId }) {
  switch (tool) {
    case 'turning':
      return <TurningTool />;
    case 'parting':
      return <PartingTool />;
    case 'boring':
      return <BoringBar />;
    case 'none':
      return null;
  }
}
