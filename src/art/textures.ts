/**
 * Procedural canvas textures for the 3D scene.
 *
 * Every helper is lazy and memoized. When there is no DOM (engine tests
 * under node) or no 2D canvas context (jsdom without the canvas package),
 * the helpers return `null` instead of throwing.
 */
import * as THREE from 'three'

export type MaterialTextureId = 'brass' | 'aluminum' | 'steel' | 'delrin'

type Ctx = CanvasRenderingContext2D

const cache = new Map<string, THREE.CanvasTexture | null>()

/** Drop all memoized textures (disposing GPU copies). Mainly for tests and hot reload. */
export function clearTextureCache(): void {
  for (const tex of cache.values()) tex?.dispose()
  cache.clear()
}

/** Small deterministic PRNG so textures look identical on every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeContext(size: number): { canvas: HTMLCanvasElement; ctx: Ctx } | null {
  if (typeof document === 'undefined') return null
  try {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    return { canvas, ctx }
  } catch {
    return null
  }
}

function memo(
  key: string,
  size: number,
  draw: (ctx: Ctx, size: number) => void,
  repeat = 1,
): THREE.CanvasTexture | null {
  if (cache.has(key)) return cache.get(key) ?? null
  const made = makeContext(size)
  let tex: THREE.CanvasTexture | null = null
  if (made) {
    draw(made.ctx, size)
    tex = new THREE.CanvasTexture(made.canvas)
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(repeat, repeat)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    tex.needsUpdate = true
  }
  cache.set(key, tex)
  return tex
}

const fill = (ctx: Ctx, color: string, size: number): void => {
  ctx.fillStyle = color
  ctx.fillRect(0, 0, size, size)
}

/** Horizontal streaks, wrapped so the texture tiles seamlessly. */
function streaks(
  ctx: Ctx,
  size: number,
  rand: () => number,
  count: number,
  opts: { maxLen: number; maxAlpha: number; thickness: number },
): void {
  for (let i = 0; i < count; i++) {
    const y = rand() * size
    const x = rand() * size
    const len = 8 + rand() * opts.maxLen
    const light = rand() > 0.5
    ctx.strokeStyle = `rgba(${light ? '255,255,255' : '0,0,0'},${(rand() * opts.maxAlpha).toFixed(3)})`
    ctx.lineWidth = 0.5 + rand() * opts.thickness
    for (const dx of [0, -size]) {
      ctx.beginPath()
      ctx.moveTo(x + dx, y)
      ctx.lineTo(x + dx + len, y)
      ctx.stroke()
    }
  }
}

/** Soft blotches (wrapped) for mottled surfaces. */
function blotches(
  ctx: Ctx,
  size: number,
  rand: () => number,
  count: number,
  opts: { minR: number; maxR: number; maxAlpha: number },
): void {
  for (let i = 0; i < count; i++) {
    const x = rand() * size
    const y = rand() * size
    const r = opts.minR + rand() * (opts.maxR - opts.minR)
    const light = rand() > 0.5
    const a = rand() * opts.maxAlpha
    for (const dx of [0, size, -size]) {
      for (const dy of [0, size, -size]) {
        const cx = x + dx
        const cy = y + dy
        if (cx < -r || cx > size + r || cy < -r || cy > size + r) continue
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
        const c = light ? '255,255,255' : '0,0,0'
        g.addColorStop(0, `rgba(${c},${a.toFixed(3)})`)
        g.addColorStop(1, `rgba(${c},0)`)
        ctx.fillStyle = g
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
      }
    }
  }
}

/** Fine pixel speckle. */
function speckle(ctx: Ctx, size: number, rand: () => number, count: number, maxAlpha: number): void {
  for (let i = 0; i < count; i++) {
    const light = rand() > 0.5
    ctx.fillStyle = `rgba(${light ? '255,255,255' : '0,0,0'},${(rand() * maxAlpha).toFixed(3)})`
    ctx.fillRect(rand() * size, rand() * size, 1, 1)
  }
}

export function brushedMetalTexture(size = 512, baseColor = '#a9aeb4'): THREE.CanvasTexture | null {
  return memo(`brushed:${size}:${baseColor}`, size, (ctx, s) => {
    const rand = mulberry32(1337)
    fill(ctx, baseColor, s)
    blotches(ctx, s, rand, 14, { minR: s * 0.1, maxR: s * 0.35, maxAlpha: 0.08 })
    streaks(ctx, s, rand, s * 6, { maxLen: s * 0.5, maxAlpha: 0.12, thickness: 1 })
    streaks(ctx, s, rand, s * 2, { maxLen: s * 0.15, maxAlpha: 0.2, thickness: 0.6 })
  })
}

export function castIronTexture(size = 512): THREE.CanvasTexture | null {
  return memo(`cast-iron:${size}`, size, (ctx, s) => {
    const rand = mulberry32(4242)
    fill(ctx, '#4b4f53', s)
    blotches(ctx, s, rand, 90, { minR: s * 0.03, maxR: s * 0.18, maxAlpha: 0.14 })
    blotches(ctx, s, rand, 40, { minR: s * 0.01, maxR: s * 0.05, maxAlpha: 0.22 })
    speckle(ctx, s, rand, s * s * 0.08, 0.28)
  })
}

export function brassTexture(size = 512): THREE.CanvasTexture | null {
  return memo(`brass:${size}`, size, (ctx, s) => {
    const rand = mulberry32(7)
    fill(ctx, '#c8a24a', s)
    blotches(ctx, s, rand, 16, { minR: s * 0.1, maxR: s * 0.3, maxAlpha: 0.09 })
    streaks(ctx, s, rand, s * 5, { maxLen: s * 0.7, maxAlpha: 0.1, thickness: 0.8 })
    // Faint turning marks: fine, evenly spaced lines.
    ctx.strokeStyle = 'rgba(90,60,10,0.07)'
    ctx.lineWidth = 1
    for (let y = 0; y < s; y += 3) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(s, y)
      ctx.stroke()
    }
  })
}

export function aluminumTexture(size = 512): THREE.CanvasTexture | null {
  return memo(`aluminum:${size}`, size, (ctx, s) => {
    const rand = mulberry32(99)
    fill(ctx, '#c2c7cd', s)
    blotches(ctx, s, rand, 20, { minR: s * 0.08, maxR: s * 0.3, maxAlpha: 0.07 })
    speckle(ctx, s, rand, s * s * 0.12, 0.18)
    streaks(ctx, s, rand, s * 3, { maxLen: s * 0.3, maxAlpha: 0.1, thickness: 0.7 })
  })
}

export function steelTexture(size = 512): THREE.CanvasTexture | null {
  return memo(`steel:${size}`, size, (ctx, s) => {
    const rand = mulberry32(2024)
    fill(ctx, '#7a838d', s)
    blotches(ctx, s, rand, 16, { minR: s * 0.08, maxR: s * 0.3, maxAlpha: 0.1 })
    streaks(ctx, s, rand, s * 7, { maxLen: s * 0.6, maxAlpha: 0.14, thickness: 0.8 })
    speckle(ctx, s, rand, s * s * 0.04, 0.2)
  })
}

export function delrinTexture(size = 512): THREE.CanvasTexture | null {
  return memo(`delrin:${size}`, size, (ctx, s) => {
    const rand = mulberry32(555)
    fill(ctx, '#eeece3', s)
    blotches(ctx, s, rand, 30, { minR: s * 0.1, maxR: s * 0.35, maxAlpha: 0.05 })
    speckle(ctx, s, rand, s * s * 0.03, 0.08)
  })
}

export function materialTextureFor(material: MaterialTextureId): THREE.CanvasTexture | null {
  switch (material) {
    case 'brass':
      return brassTexture()
    case 'aluminum':
      return aluminumTexture()
    case 'steel':
      return steelTexture()
    case 'delrin':
      return delrinTexture()
  }
}
