// Sheet-metal chip tray with a back splash guard, sitting on a wooden bench.
import { BED_X_MAX, BED_X_MIN, CHIP_TRAY_Y } from '../helpers';
import { machineMaterials } from '../materials';

const X0 = BED_X_MIN - 0.8;
const X1 = BED_X_MAX + 0.8;
const Z0 = -3.6;
const Z1 = 5.2;
const W = X1 - X0;
const D = Z1 - Z0;
const CX = (X0 + X1) / 2;
const CZ = (Z0 + Z1) / 2;
const WALL = 0.9;
const SPLASH = 9;

export function ChipTray() {
  const m = machineMaterials();
  return (
    <group>
      <mesh material={m.sheetMetal} position={[CX, CHIP_TRAY_Y - 0.05, CZ]} receiveShadow>
        <boxGeometry args={[W, 0.1, D]} />
      </mesh>
      {/* front lip and side walls */}
      <mesh material={m.sheetMetal} position={[CX, CHIP_TRAY_Y + WALL / 2, Z1]} castShadow receiveShadow>
        <boxGeometry args={[W, WALL, 0.06]} />
      </mesh>
      {[X0, X1].map((x) => (
        <mesh key={x} material={m.sheetMetal} position={[x, CHIP_TRAY_Y + WALL / 2, CZ]} castShadow receiveShadow>
          <boxGeometry args={[0.06, WALL, D]} />
        </mesh>
      ))}
      {/* back splash guard */}
      <mesh material={m.sheetMetal} position={[CX, CHIP_TRAY_Y + SPLASH / 2, Z0]} receiveShadow>
        <boxGeometry args={[W, SPLASH, 0.06]} />
      </mesh>
      {/* bench top */}
      <mesh material={m.wood} position={[CX, CHIP_TRAY_Y - 0.9, CZ + 2]} receiveShadow>
        <boxGeometry args={[W + 16, 1.6, D + 12]} />
      </mesh>
    </group>
  );
}
