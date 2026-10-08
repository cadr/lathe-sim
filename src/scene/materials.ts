// Shared machine materials, created once and reused by every part.
// Textures come from src/art (lazy; null without a DOM), so this stays safe to import in tests.
import * as THREE from 'three';
import { brushedMetalTexture, castIronTexture } from '../art/textures';

export interface MachineMaterials {
  castIron: THREE.MeshStandardMaterial;
  ground: THREE.MeshStandardMaterial;
  paintGreen: THREE.MeshStandardMaterial;
  paintRed: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  chuckFace: THREE.MeshStandardMaterial;
  darkSteel: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  blackOxide: THREE.MeshStandardMaterial;
  carbide: THREE.MeshStandardMaterial;
  hss: THREE.MeshStandardMaterial;
  /** freshly ground HSS parting blade: bright, so the thin blade reads against the work */
  blade: THREE.MeshStandardMaterial;
  /** blued-steel tool holder: lighter than the black-oxide toolpost so tools stand out */
  toolHolder: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  sheetMetal: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  label: THREE.MeshStandardMaterial;
  hole: THREE.MeshStandardMaterial;
}

let cached: MachineMaterials | null = null;

function std(params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial(params);
}

/** Memoized machine materials (one set per page). */
export function machineMaterials(): MachineMaterials {
  if (cached) return cached;
  const iron = castIronTexture();
  const brushed = brushedMetalTexture();
  cached = {
    castIron: std({ color: iron ? '#8a8d90' : '#3a3d40', map: iron ?? null, metalness: 0.55, roughness: 0.75 }),
    ground: std({ color: brushed ? '#e4e8ec' : '#b8bec4', map: brushed ?? null, metalness: 0.85, roughness: 0.3 }),
    paintGreen: std({ color: '#3f5e52', metalness: 0.15, roughness: 0.55 }),
    paintRed: std({ color: '#b3261e', metalness: 0.1, roughness: 0.45 }),
    steel: std({ color: brushed ? '#d0d4d8' : '#a8adb3', map: brushed ?? null, metalness: 0.8, roughness: 0.38 }),
    chuckFace: std({ color: '#9ea4aa', metalness: 0.65, roughness: 0.5 }),
    darkSteel: std({ color: '#5d636a', metalness: 0.85, roughness: 0.4 }),
    chrome: std({ color: '#e8ecef', metalness: 1, roughness: 0.12 }),
    blackOxide: std({ color: '#2c3035', metalness: 0.6, roughness: 0.45 }),
    carbide: std({ color: '#c9b46a', metalness: 0.9, roughness: 0.3 }),
    hss: std({ color: '#d5d9de', metalness: 0.7, roughness: 0.32 }),
    blade: std({ color: '#f1f4f7', metalness: 0.45, roughness: 0.28, emissive: '#30363d', emissiveIntensity: 0.6 }),
    toolHolder: std({ color: '#7f8893', metalness: 0.75, roughness: 0.38 }),
    brass: std({ color: '#e3b84f', metalness: 1, roughness: 0.22 }),
    rubber: std({ color: '#161616', metalness: 0, roughness: 0.9 }),
    sheetMetal: std({ color: '#5d646b', metalness: 0.7, roughness: 0.5 }),
    wood: std({ color: '#5a4030', metalness: 0, roughness: 0.85 }),
    label: std({ color: '#f2efe6', metalness: 0, roughness: 0.6 }),
    hole: std({ color: '#0b0c0d', metalness: 0.2, roughness: 0.9 }),
  };
  return cached;
}
