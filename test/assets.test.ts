import { describe, expect, it } from 'vitest'
import { AssetPathError, listAssets, readAsset } from '../lib/engine/assets'

const DIR = 'test/assets'

describe('readAsset', () => {
  it('reads a file inside the assets directory', () => {
    expect(new TextDecoder().decode(readAsset(DIR, 'meals/a.jpg'))).toBe('a')
  })

  it('rejects a path that climbs out with ..', () => {
    expect(() => readAsset(DIR, '../../package.json')).toThrow(AssetPathError)
  })

  it('rejects a path that climbs out and back in', () => {
    expect(() => readAsset(DIR, 'meals/../../../package.json')).toThrow(AssetPathError)
  })

  it('rejects an absolute path', () => {
    expect(() => readAsset(DIR, '/etc/hosts')).toThrow(AssetPathError)
  })

  it('rejects a sibling directory whose name merely starts with the root name', () => {
    expect(() => readAsset(DIR, '../assetsX/leak.txt')).toThrow(AssetPathError)
  })

  it('keeps a path that climbs out and back in below the root', () => {
    expect(new TextDecoder().decode(readAsset(DIR, 'meals/../meals/b.jpg'))).toBe('b')
  })

  it('names the requested path on the error', () => {
    try {
      readAsset(DIR, '../secret')
      throw new Error('should have thrown')
    } catch (error) {
      expect((error as AssetPathError).requested).toBe('../secret')
    }
  })
})

describe('listAssets', () => {
  it('lists a folder inside the assets directory, sorted', () => {
    expect(listAssets(DIR, 'meals')).toEqual(['a.jpg', 'b.jpg'])
  })

  it('rejects a folder outside the assets directory', () => {
    expect(() => listAssets(DIR, '../..')).toThrow(AssetPathError)
  })

  it('allows the assets root itself', () => {
    expect(listAssets(DIR, '')).toContain('meals')
  })
})
