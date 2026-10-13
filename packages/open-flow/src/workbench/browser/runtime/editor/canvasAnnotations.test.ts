import { describe, expect, it } from 'vitest'
import { canvasAnnotations } from './canvasAnnotations.ts'

const draft = { flowId: 'flow', revisionId: 'r1' }

describe('Workbench annotation context', () => {
  it('uses the saved revision without duplicating the browser source URL', () => {
    expect(canvasAnnotations('flow', draft, 'saved', undefined, false)).toEqual({
      flowId: 'flow',
      revisionId: 'r1',
      syncState: 'saved',
    })
    expect(canvasAnnotations('flow', { ...draft, revisionId: 'r2' }, 'saved', 'saved', false)?.revisionId).toBe('r2')
  })

  it.each([
    ['saved', 'dirty', false, 'dirty'],
    ['saved', 'saving', false, 'saving'],
    ['saving', 'dirty', false, 'saving'],
    ['saved', 'failed', false, 'failed'],
    ['failed', 'saved', false, 'failed'],
    ['saving', 'saved', true, 'failed'],
  ] as const)('derives %s / %s / failure %s as %s', (status, moduleStatus, failed, expected) => {
    const value = canvasAnnotations('flow', draft, status, moduleStatus, failed)
    expect(value?.syncState).toBe(expected)
    expect(value?.revisionId).toBe('r1')
  })

  it('omits semantics while context is missing, loading or belongs to the previous Flow', () => {
    expect(canvasAnnotations(undefined, draft, 'saved', undefined, false)).toBeUndefined()
    expect(canvasAnnotations('flow', undefined, 'saved', undefined, false)).toBeUndefined()
    expect(canvasAnnotations('other', draft, 'saved', undefined, false)).toBeUndefined()
    expect(canvasAnnotations('flow', draft, 'loading', undefined, false)).toBeUndefined()
    expect(canvasAnnotations('flow', draft, 'noDraft', undefined, false)).toBeUndefined()
  })
})
