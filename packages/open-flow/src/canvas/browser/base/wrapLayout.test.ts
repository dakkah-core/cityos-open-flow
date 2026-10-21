import { describe, expect, it } from 'vitest'
import { wrapLayout } from './wrapLayout.ts'

const chain = (count: number) =>
  Array.from({ length: count }, (_, column) => ({ id: String(column), column, x: 80 + column * 400, y: 80, width: 320, height: 120 }))

describe('wrapped graph layout', () => {
  it('keeps short chains unchanged and wraps long chains in reading order', () => {
    const short = wrapLayout(chain(6))
    expect(Object.values(short)).toEqual(chain(6).map(({ x, y }) => ({ x, y })))
    const long = wrapLayout(chain(12))
    expect(Object.fromEntries(Object.entries(long).slice(0, 6))).toEqual(short)
    expect(new Set(Object.values(long).map(({ y }) => y)).size).toBe(2)
    expect(long['6']!.x).toBe(long['0']!.x)
    expect(long['6']!.y).toBeGreaterThan(long['5']!.y + 120)
    expect(Math.max(...Object.values(long).map(({ x }) => x))).toBe(short['5']!.x)
    expect(wrapLayout(chain(13))['11']).toEqual(long['11'])
  })

  it('fills the available width using full node bounds, including exact fits', () => {
    const nodes = chain(12)
    const wide = wrapLayout(nodes, 2320)
    expect(wide['5']!.y).toBe(wide['0']!.y)
    expect(wide['6']!.x).toBe(wide['0']!.x)
    expect(wide['6']!.y).toBeGreaterThan(wide['5']!.y + 120)
    const narrow = wrapLayout(nodes, 719)
    expect(narrow['1']!.x).toBe(narrow['0']!.x)
    expect(narrow['1']!.y).toBeGreaterThan(narrow['0']!.y)
    expect(wrapLayout(nodes, 720)['1']!.y).toBe(narrow['0']!.y)
  })

  it('uses the widest branch and keeps oversized columns intact', () => {
    const nodes = [...chain(3), { id: 'branch', column: 1, x: 380, y: 300, width: 900, height: 600 }]
    const positions = wrapLayout(nodes, 800)
    expect(positions['1']!.y).toBeGreaterThan(positions['0']!.y + 120)
    expect(positions['1']!.x - positions.branch!.x).toBe(100)
    expect(positions.branch!.y - positions['1']!.y).toBe(220)
    expect(positions['2']!.y).toBeGreaterThan(positions.branch!.y + 600)
    expect(wrapLayout([], 800)).toEqual({})
  })

  it('keeps parallel nodes together and leaves room below the tallest branch', () => {
    const nodes = [...chain(8), { id: 'branch', column: 3, x: 1280, y: 300, width: 320, height: 600 }]
    const positions = wrapLayout(nodes)
    expect(positions.branch).toEqual({ x: 1280, y: 300 })
    expect(positions['6']!.y).toBeGreaterThan(positions.branch!.y + 600)
    expect(positions['7']!.x).toBeGreaterThan(positions['6']!.x)
    expect(wrapLayout([])).toEqual({})
  })
})
