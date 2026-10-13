import { describe, expect, it } from 'vitest'
import { wrapLayout } from './wrapLayout.ts'

const chain = (count: number) => Array.from({ length: count }, (_, column) => ({ id: String(column), column, x: 80 + column * 400, y: 80, height: 120 }))

describe('wrapped graph layout', () => {
  it('keeps short chains unchanged and wraps long chains in reading order', () => {
    const short = wrapLayout(chain(4))
    expect(Object.values(short)).toEqual(chain(4).map(({ x, y }) => ({ x, y })))
    const long = wrapLayout(chain(12))
    expect(Object.fromEntries(Object.entries(long).slice(0, 4))).toEqual(short)
    expect(new Set(Object.values(long).map(({ y }) => y)).size).toBe(3)
    expect(long['4']!.x).toBe(long['0']!.x)
    expect(long['4']!.y).toBeGreaterThan(long['3']!.y + 120)
    expect(Math.max(...Object.values(long).map(({ x }) => x))).toBe(short['3']!.x)
    expect(wrapLayout(chain(13))['11']).toEqual(long['11'])
  })

  it('keeps parallel nodes together and leaves room below the tallest branch', () => {
    const nodes = [...chain(6), { id: 'branch', column: 3, x: 1280, y: 300, height: 600 }]
    const positions = wrapLayout(nodes)
    expect(positions.branch).toEqual({ x: 1280, y: 300 })
    expect(positions['4']!.y).toBeGreaterThan(positions.branch!.y + 600)
    expect(positions['5']!.x).toBeGreaterThan(positions['4']!.x)
    expect(wrapLayout([])).toEqual({})
  })
})
