// The stock in the chuck (rebuilt from latheGeometryPoints when `version` changes)
// and parted pieces that drop into the chip tray.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { latheGeometryPoints } from '../engine';
import type { Material, Workpiece as WorkpieceModel } from '../engine';
import { materialTextureFor } from '../art/textures';
import { useLathe } from '../store';
import {
  LATHE_SEGMENTS,
  PART_FALL_DURATION,
  fallProgress,
  latheGeometryFromPoints,
  lerpPose,
  materialLookFor,
  partedPieceRestPose,
  workpieceExtent,
  type Pose,
} from './helpers';

const materialCache = new Map<Material, THREE.MeshStandardMaterial>();

/** One shared PBR material per stock material (texture when available, flat colour otherwise). */
export function stockMaterial(material: Material): THREE.MeshStandardMaterial {
  const hit = materialCache.get(material);
  if (hit) return hit;
  const look = materialLookFor(material);
  const map = materialTextureFor(material);
  const mat = new THREE.MeshStandardMaterial({
    color: map ? '#ffffff' : look.color,
    map: map ?? null,
    metalness: look.metalness,
    roughness: look.roughness,
    envMapIntensity: 1.2,
  });
  if (map) mat.color.set(look.color).lerp(new THREE.Color('#ffffff'), 0.55);
  materialCache.set(material, mat);
  return mat;
}

/**
 * Lathe geometry for a workpiece, rebuilt when the workpiece changes. The previous geometry is
 * disposed once it is replaced, and the last one on unmount. Disposal on unmount is deferred a
 * microtask so StrictMode's dev-only unmount/remount does not dispose a geometry still in use.
 */
export function useLatheGeometry(wp: WorkpieceModel | null, yOffset = 0): THREE.LatheGeometry | null {
  const geo = useMemo(() => (wp ? latheGeometryFromPoints(latheGeometryPoints(wp), LATHE_SEGMENTS, yOffset) : null), [wp, yOffset]);
  const live = useRef<THREE.LatheGeometry | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    const old = live.current;
    live.current = geo;
    if (old && old !== geo) old.dispose();
  }, [geo]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (mounted.current) return;
        live.current?.dispose();
        live.current = null;
      });
    };
  }, []);
  return geo;
}

/** The chucked stock. LatheGeometry revolves about +Y; the mesh rotates Y onto the spindle (+X). */
function Stock() {
  const version = useLathe((s) => s.version);
  // `version` bumps exactly when the workpiece (or parted pieces) change
  const wp = useMemo(() => {
    void version;
    return useLathe.getState().state.workpiece;
  }, [version]);
  const geo = useLatheGeometry(wp);
  const spin = useRef<THREE.Group>(null);
  useFrame(() => {
    if (spin.current) spin.current.rotation.x = useLathe.getState().state.spindle.angle;
  });
  if (!wp || !geo) return null;
  return (
    <group ref={spin}>
      <mesh geometry={geo} material={stockMaterial(wp.material)} rotation-z={-Math.PI / 2} castShadow receiveShadow />
    </group>
  );
}

// stable ids per parted piece object so a new piece always animates
const pieceIds = new WeakMap<WorkpieceModel, number>();
let nextPieceId = 1;
function pieceId(wp: WorkpieceModel): number {
  let id = pieceIds.get(wp);
  if (id === undefined) {
    id = nextPieceId++;
    pieceIds.set(wp, id);
  }
  return id;
}

function PartedPiece({ wp, index }: { wp: WorkpieceModel; index: number }) {
  const ext = useMemo(() => workpieceExtent(wp), [wp]);
  const geo = useLatheGeometry(wp, ext ? -ext.center : 0);
  const ref = useRef<THREE.Group>(null);
  const elapsed = useRef(0);
  const poses = useMemo(() => {
    const radius = ext?.radius ?? 0.5;
    const from: Pose = { position: [ext?.center ?? 0, 0, 0], rotation: [0, 0, 0] };
    const rest = partedPieceRestPose(index, radius);
    // tumble a quarter turn about the spindle axis on the way down
    const to: Pose = { position: rest.position, rotation: [Math.PI * 0.5, rest.rotation[1], 0] };
    return { from, to, cur: { position: [0, 0, 0], rotation: [0, 0, 0] } as Pose };
  }, [ext, index]);

  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    if (elapsed.current > PART_FALL_DURATION && g.userData.rested) return;
    elapsed.current += Math.min(dt, 0.05);
    const u = fallProgress(elapsed.current);
    const p = lerpPose(poses.from, poses.to, u, poses.cur);
    // fall straight down first, drift forward into the tray as it drops
    g.position.set(p.position[0], p.position[1], poses.from.position[2] + (poses.to.position[2] - poses.from.position[2]) * Math.sqrt(u));
    g.rotation.set(p.rotation[0], p.rotation[1], p.rotation[2]);
    if (u >= 1) g.userData.rested = true;
  });

  if (!geo) return null;
  return (
    <group ref={ref} position={poses.from.position}>
      <mesh geometry={geo} material={stockMaterial(wp.material)} rotation-z={-Math.PI / 2} castShadow receiveShadow />
    </group>
  );
}

function PartedPieces() {
  const pieces = useLathe((s) => s.state.partedPieces);
  return (
    <>
      {pieces.map((wp, i) => (
        <PartedPiece key={pieceId(wp)} wp={wp} index={i} />
      ))}
    </>
  );
}

export function Workpiece() {
  return (
    <>
      <Stock />
      <PartedPieces />
    </>
  );
}
