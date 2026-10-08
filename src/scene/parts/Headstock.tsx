// Headstock casting with the gear cover, control panel and the spindle nose.
import { RoundedBox } from '@react-three/drei';
import { BED_X_MIN, CHUCK_BODY_LENGTH, WAYS_TOP_Y } from '../helpers';
import { machineMaterials } from '../materials';
import { MACHINE } from '../../engine';

/** Scene X of the headstock's right face (just behind the chuck backplate). */
export const HEADSTOCK_FACE_X = -MACHINE.chuckJawLength - CHUCK_BODY_LENGTH - 0.75;
const X0 = BED_X_MIN + 0.3;
const LEN = HEADSTOCK_FACE_X - X0;
const TOP = 2.6;
const H = TOP - WAYS_TOP_Y;
const Z0 = -2.6;
const Z1 = 2.4;

export function Headstock() {
  const m = machineMaterials();
  const cx = X0 + LEN / 2;
  const cy = WAYS_TOP_Y + H / 2;
  const cz = (Z0 + Z1) / 2;
  return (
    <group>
      {/* main casting */}
      <RoundedBox args={[LEN, H, Z1 - Z0]} radius={0.25} smoothness={3} material={m.paintGreen} position={[cx, cy, cz]} castShadow receiveShadow />
      {/* rounded spindle boss on the right face */}
      <mesh material={m.paintGreen} position={[HEADSTOCK_FACE_X + 0.15, 0, 0]} rotation-z={Math.PI / 2} castShadow>
        <cylinderGeometry args={[1.5, 1.5, 0.3, 40]} />
      </mesh>
      {/* gear cover on the left end */}
      <RoundedBox args={[1.0, H - 0.4, Z1 - Z0 - 0.2]} radius={0.3} smoothness={3} material={m.paintGreen} position={[X0 - 0.4, cy + 0.2, cz]} castShadow />
      {/* raised top cover with a lifting knob */}
      <RoundedBox args={[LEN - 1.6, 0.3, Z1 - Z0 - 0.8]} radius={0.1} smoothness={2} material={m.paintGreen} position={[cx + 0.4, TOP + 0.08, cz]} castShadow />
      <mesh material={m.blackOxide} position={[cx + 0.4, TOP + 0.34, cz + 0.6]}>
        <cylinderGeometry args={[0.22, 0.26, 0.22, 20]} />
      </mesh>
      {/* control panel on the front */}
      <group position={[cx + 0.5, cy + 0.6, Z1 + 0.02]}>
        <mesh material={m.blackOxide}>
          <boxGeometry args={[4.6, 2.4, 0.06]} />
        </mesh>
        {/* emergency stop */}
        <mesh material={m.paintRed} position={[-1.5, 0.3, 0.2]} rotation-x={Math.PI / 2} castShadow>
          <cylinderGeometry args={[0.38, 0.42, 0.32, 28]} />
        </mesh>
        <mesh material={m.paintRed} position={[-1.5, 0.3, 0.05]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.55, 0.55, 0.06, 28]} />
        </mesh>
        {/* speed knob */}
        <mesh material={m.chrome} position={[0.2, 0.3, 0.15]} rotation-x={Math.PI / 2} castShadow>
          <cylinderGeometry args={[0.32, 0.36, 0.26, 24]} />
        </mesh>
        {/* FWD/REV switch */}
        <mesh material={m.label} position={[1.5, 0.3, 0.06]}>
          <boxGeometry args={[0.9, 0.5, 0.06]} />
        </mesh>
        <mesh material={m.blackOxide} position={[1.5, 0.3, 0.2]} rotation-x={0.4}>
          <boxGeometry args={[0.16, 0.3, 0.2]} />
        </mesh>
        {/* brass nameplate */}
        <mesh material={m.brass} position={[0, -0.75, 0.05]}>
          <boxGeometry args={[3.2, 0.5, 0.04]} />
        </mesh>
      </group>
    </group>
  );
}
