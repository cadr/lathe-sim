// Tools held in the tailstock quill. Local origin = quill face; the tool points −X
// (toward the chuck) and its tip lands at −TAILSTOCK_TOOLS[tool].length.
import { forwardRef, useMemo } from 'react';
import * as THREE from 'three';
import { TAILSTOCK_TOOLS } from '../../engine';
import type { TailstockToolId } from '../../engine';
import { machineMaterials } from '../materials';

const CHUCK_LEN = 1.05;
/** Half of the 118° point angle. */
const HALF_POINT = (59 * Math.PI) / 180;

/** Helical flute strip: a tube wound around the drill axis (local +Y, from 0 to len). */
function useFlute(radius: number, len: number, phase: number): THREE.TubeGeometry {
  return useMemo(() => {
    const turns = len / (radius * 2 * Math.PI * 0.55); // ~ 30° helix
    const pts: THREE.Vector3[] = [];
    const n = Math.max(24, Math.ceil(turns * 24));
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const a = phase + u * turns * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * radius * 0.62, u * len, Math.sin(a) * radius * 0.62));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n, radius * 0.38, 8, false);
  }, [radius, len, phase]);
}

function DrillChuck() {
  const m = machineMaterials();
  return (
    <group>
      <mesh material={m.steel} position-x={-0.4} rotation-z={Math.PI / 2} castShadow>
        <cylinderGeometry args={[0.55, 0.55, 0.8, 32]} />
      </mesh>
      {/* knurled sleeve suggestion: dark band */}
      <mesh material={m.darkSteel} position-x={-0.55} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.565, 0.565, 0.3, 32]} />
      </mesh>
      <mesh material={m.steel} position-x={-(0.8 + (CHUCK_LEN - 0.8) / 2)} rotation-z={Math.PI / 2} castShadow>
        <cylinderGeometry args={[0.55, 0.22, CHUCK_LEN - 0.8, 32]} />
      </mesh>
      {/* key hole */}
      <mesh material={m.hole} position={[-0.25, 0.55, 0]}>
        <cylinderGeometry args={[0.07, 0.07, 0.03, 10]} />
      </mesh>
    </group>
  );
}

/** Twist drill pointing −X with tip at x = −length; shank starts at the chuck nose. */
function TwistDrill({ radius, length, material }: { radius: number; length: number; material: THREE.Material }) {
  const pointLen = radius / Math.tan(HALF_POINT);
  const body = length - CHUCK_LEN - pointLen;
  const flute0 = useFlute(radius, body * 0.85, 0);
  const flute1 = useFlute(radius, body * 0.85, Math.PI);
  return (
    // local +Y runs from the chuck nose toward the tip, so rotate +Y onto −X
    <group position-x={-CHUCK_LEN} rotation-z={Math.PI / 2}>
      <mesh material={material} position-y={body / 2} castShadow>
        <cylinderGeometry args={[radius * 0.42, radius * 0.42, body, 12]} />
      </mesh>
      <mesh material={material} position-y={body * 0.075} castShadow>
        <cylinderGeometry args={[radius, radius, body * 0.15, 16]} />
      </mesh>
      <mesh geometry={flute0} material={material} position-y={body * 0.15} castShadow />
      <mesh geometry={flute1} material={material} position-y={body * 0.15} castShadow />
      <mesh material={material} position-y={body + pointLen / 2} castShadow>
        <coneGeometry args={[radius, pointLen, 16]} />
      </mesh>
    </group>
  );
}

function CenterDrill() {
  const m = machineMaterials();
  const len = TAILSTOCK_TOOLS['center-drill'].length;
  const pilotR = 0.04;
  const bodyR = 0.156;
  const exposed = len - CHUCK_LEN;
  return (
    <group position-x={-CHUCK_LEN} rotation-z={Math.PI / 2}>
      <mesh material={m.hss} position-y={(exposed - 0.2) / 2} castShadow>
        <cylinderGeometry args={[bodyR, bodyR, exposed - 0.2, 20]} />
      </mesh>
      {/* 60° countersink cone down to the pilot */}
      <mesh material={m.hss} position-y={exposed - 0.16}>
        <cylinderGeometry args={[pilotR, bodyR, 0.08, 20]} />
      </mesh>
      <mesh material={m.hss} position-y={exposed - 0.08}>
        <cylinderGeometry args={[pilotR, pilotR, 0.08, 12]} />
      </mesh>
      <mesh material={m.hss} position-y={exposed - 0.02}>
        <coneGeometry args={[pilotR, 0.04, 12]} />
      </mesh>
    </group>
  );
}

/** Live center: bearing housing in the quill plus a 60° point that spins (spinRef). */
const LiveCenter = forwardRef<THREE.Group>(function LiveCenter(_props, spinRef) {
  const m = machineMaterials();
  const len = TAILSTOCK_TOOLS['live-center'].length;
  const pointLen = 0.6;
  return (
    <group>
      <mesh material={m.steel} position-x={-0.15} rotation-z={Math.PI / 2} castShadow>
        <cylinderGeometry args={[0.52, 0.52, 0.3, 32]} />
      </mesh>
      <mesh material={m.darkSteel} position-x={-0.3 - (len - pointLen - 0.3) / 2} rotation-z={Math.PI / 2} castShadow>
        <cylinderGeometry args={[0.42, 0.45, len - pointLen - 0.3, 32]} />
      </mesh>
      <group ref={spinRef} position-x={-(len - pointLen)}>
        <mesh material={m.chrome} position-x={-pointLen / 2} rotation-z={Math.PI / 2} castShadow>
          <coneGeometry args={[0.3, pointLen, 32]} />
        </mesh>
        {/* a small flat so the spin is visible */}
        <mesh material={m.darkSteel} position={[-0.12, 0.24, 0]}>
          <boxGeometry args={[0.16, 0.04, 0.12]} />
        </mesh>
      </group>
    </group>
  );
});

export const TailstockTool = forwardRef<THREE.Group, { tool: TailstockToolId }>(function TailstockTool({ tool }, spinRef) {
  const m = machineMaterials();
  switch (tool) {
    case 'none':
      return null;
    case 'live-center':
      return <LiveCenter ref={spinRef} />;
    case 'center-drill':
      return (
        <group>
          <DrillChuck />
          <CenterDrill />
        </group>
      );
    case 'drill-1/8':
    case 'drill-1/4':
      return (
        <group>
          <DrillChuck />
          <TwistDrill radius={TAILSTOCK_TOOLS[tool].radius} length={TAILSTOCK_TOOLS[tool].length} material={m.hss} />
        </group>
      );
  }
});
