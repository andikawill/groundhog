import { describe, expect, it } from 'vitest'
import { readPath } from '../lib/engine/path'

const doc = {
  data: {
    id: 'j_1',
    items: [{ name: 'nasi lemak', kcal: 400 }, { name: 'teh tarik' }],
    empty: [],
    nullish: null,
  },
}

describe('readPath', () => {
  it('reads a nested field', () => {
    expect(readPath(doc, '$.data.id')).toBe('j_1')
  })

  it('reads through an array index', () => {
    expect(readPath(doc, '$.data.items[0].name')).toBe('nasi lemak')
  })

  it('returns the whole document for $', () => {
    expect(readPath(doc, '$')).toBe(doc)
  })

  it('accepts a path without the $ prefix', () => {
    expect(readPath(doc, 'data.id')).toBe('j_1')
  })

  it('returns an array when the path points at one', () => {
    expect(readPath(doc, '$.data.items')).toHaveLength(2)
  })

  it('returns undefined for a missing field', () => {
    expect(readPath(doc, '$.data.missing')).toBeUndefined()
  })

  it('returns undefined instead of throwing when traversing null', () => {
    expect(readPath(doc, '$.data.nullish.deep')).toBeUndefined()
  })

  it('returns undefined for an out-of-range index', () => {
    expect(readPath(doc, '$.data.items[9].name')).toBeUndefined()
  })

  it('returns undefined when the root is not an object', () => {
    expect(readPath('plain text', '$.data')).toBeUndefined()
  })
})
