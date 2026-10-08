// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  aluminumTexture,
  brassTexture,
  brushedMetalTexture,
  castIronTexture,
  clearTextureCache,
  delrinTexture,
  materialTextureFor,
  steelTexture,
} from '../textures'

/** Minimal fake 2D context: every method is a no-op, gradients accept color stops. */
function fakeContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => undefined }
  return new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'createRadialGradient' || prop === 'createLinearGradient') return () => gradient
        return () => undefined
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  clearTextureCache()
})

describe('textures: no document', () => {
  it('returns null for every helper', () => {
    vi.stubGlobal('document', undefined)
    expect(brushedMetalTexture(64, '#888')).toBeNull()
    expect(castIronTexture(64)).toBeNull()
    expect(brassTexture(64)).toBeNull()
    expect(aluminumTexture(64)).toBeNull()
    expect(steelTexture(64)).toBeNull()
    expect(delrinTexture(64)).toBeNull()
    expect(materialTextureFor('brass')).toBeNull()
  })
})

describe('textures: no 2d context', () => {
  it('returns null gracefully and memoizes the null', () => {
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    expect(brassTexture(64)).toBeNull()
    expect(brassTexture(64)).toBeNull()
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('textures: with a (fake) 2d context', () => {
  it('memoizes by name and arguments', () => {
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(() => fakeContext() as never)
    const a = brushedMetalTexture(64, '#999999')
    const b = brushedMetalTexture(64, '#999999')
    expect(a).not.toBeNull()
    expect(a).toBe(b)
    expect(brushedMetalTexture(64, '#111111')).not.toBe(a)
    expect(brushedMetalTexture(32, '#999999')).not.toBe(a)
    expect(spy).toHaveBeenCalledTimes(3)
  })

  it('materialTextureFor returns the same memoized texture as the direct helper', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeContext() as never)
    expect(materialTextureFor('steel')).toBe(steelTexture())
    expect(materialTextureFor('brass')).toBe(brassTexture())
    expect(materialTextureFor('aluminum')).toBe(aluminumTexture())
    expect(materialTextureFor('delrin')).toBe(delrinTexture())
  })

  it('clearTextureCache forces regeneration', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeContext() as never)
    const a = castIronTexture(64)
    clearTextureCache()
    expect(castIronTexture(64)).not.toBe(a)
  })
})
