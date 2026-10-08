// Cast-iron bed: two rails with ground ways (a V-way at the front), cross ribs, the
// rack and leadscrew along the front, and end risers standing in the chip tray.
import { BED_DEPTH, BED_WIDTH, BED_X_MAX, BED_X_MIN, CHIP_TRAY_Y, WAYS_TOP_Y } from '../helpers';
import { machineMaterials } from '../materials';

const LEN = BED_X_MAX - BED_X_MIN;
const MID = (BED_X_MAX + BED_X_MIN) / 2;
const RAIL_W = 1.15;
const RAIL_Z = BED_WIDTH / 2 - RAIL_W / 2;
const RAIL_Y = WAYS_TOP_Y - BED_DEPTH / 2;

export function Bed() {
  const m = machineMaterials();
  const ribs: number[] = [];
  for (let x = BED_X_MIN + 2; x < BED_X_MAX - 0.5; x += 3.2) ribs.push(x);
  const riserH = WAYS_TOP_Y - BED_DEPTH - CHIP_TRAY_Y;
  return (
    <group>
      {/* rails */}
      {[RAIL_Z, -RAIL_Z].map((z) => (
        <mesh key={z} material={m.castIron} position={[MID, RAIL_Y - 0.05, z]} castShadow receiveShadow>
          <boxGeometry args={[LEN, BED_DEPTH - 0.1, RAIL_W]} />
        </mesh>
      ))}
      {/* ground way surfaces */}
      {[RAIL_Z, -RAIL_Z].map((z) => (
        <mesh key={`w${z}`} material={m.ground} position={[MID, WAYS_TOP_Y - 0.05, z]} receiveShadow castShadow>
          <boxGeometry args={[LEN, 0.1, RAIL_W]} />
        </mesh>
      ))}
      {/* front V-way prism and back flat way */}
      <mesh material={m.ground} position={[MID, WAYS_TOP_Y, RAIL_Z + 0.25]} rotation-x={Math.PI / 4} castShadow>
        <boxGeometry args={[LEN, 0.28, 0.28]} />
      </mesh>
      <mesh material={m.ground} position={[MID, WAYS_TOP_Y, -RAIL_Z - 0.25]} rotation-x={Math.PI / 4} castShadow>
        <boxGeometry args={[LEN, 0.28, 0.28]} />
      </mesh>
      {/* cross ribs between the rails */}
      {ribs.map((x) => (
        <mesh key={x} material={m.castIron} position={[x, RAIL_Y - 0.3, 0]} castShadow>
          <boxGeometry args={[0.45, BED_DEPTH - 0.7, BED_WIDTH - 2 * RAIL_W + 0.02]} />
        </mesh>
      ))}
      {/* rack under the front way */}
      <mesh material={m.darkSteel} position={[MID, WAYS_TOP_Y - 0.55, BED_WIDTH / 2 + 0.08]}>
        <boxGeometry args={[LEN - 0.4, 0.3, 0.16]} />
      </mesh>
      {/* leadscrew and its end bearings */}
      <mesh material={m.steel} position={[MID + 0.5, WAYS_TOP_Y - 1.7, BED_WIDTH / 2 + 0.45]} rotation-z={Math.PI / 2} castShadow>
        <cylinderGeometry args={[0.16, 0.16, LEN - 1.2, 16]} />
      </mesh>
      {[BED_X_MIN + 0.9, BED_X_MAX - 0.35].map((x) => (
        <mesh key={`b${x}`} material={m.paintGreen} position={[x, WAYS_TOP_Y - 1.5, BED_WIDTH / 2 + 0.35]} castShadow>
          <boxGeometry args={[0.7, 1.0, 0.6]} />
        </mesh>
      ))}
      {/* end risers (feet) */}
      {[BED_X_MIN + 1.2, BED_X_MAX - 1.2].map((x) => (
        <mesh key={`r${x}`} material={m.castIron} position={[x, CHIP_TRAY_Y + riserH / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.2, riserH, BED_WIDTH + 0.6]} />
        </mesh>
      ))}
    </group>
  );
}
