import type { NodeId } from '../../../../schema/index.ts'
import type { RFNode } from '../../base/rfHelpers.ts'
import type { NodeContent } from '../FlowCanvas/nodeContent.ts'

import { renderToStaticMarkup } from 'react-dom/server'
import { val } from 'value-enhancer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommentNodeStore } from '../../stores/node/commentNode.store.ts'
import { NODE_TYPE } from '../../stores/node/constants.ts'
import { NodeStore } from '../../stores/node/node.store.ts'
import { CanvasAnnotationContext } from '../annotations.tsx'
import { SelectionAnnotation } from './selectionAnnotation.tsx'

const hooks = vi.hoisted(() => ({
  state: { domNode: { querySelector: vi.fn() }, nodesSelectionActive: true, userSelectionActive: false },
  cleanups: [] as (() => void)[],
}))
vi.mock('@xyflow/react', () => ({ useStore: (select: (state: typeof hooks.state) => unknown) => select(hooks.state) }))
vi.mock('val-i18n-react', () => ({ useTranslate: () => (key: string, values?: { count: number }) => `${key}:${values?.count ?? ''}` }))
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useLayoutEffect: (effect: () => (() => void) | undefined) => {
    const dispose = effect()
    if (dispose) hooks.cleanups.push(dispose)
  },
}))

const stores: (NodeStore | CommentNodeStore)[] = []
function node(id: string): RFNode {
  const content: NodeContent = { id, title: id, kind: 'task', reference: 'task', inputs: [], outputs: [] }
  const store = new NodeStore(id as NodeId, NODE_TYPE.TaskNode, { content$: val<NodeContent>(content), ignoredNodeIds: val([]), position: { x: 0, y: 0 } })
  stores.push(store)
  return store.$.rfNode.value
}
function cleanup() {
  for (const dispose of hooks.cleanups.splice(0)) dispose()
}
function render(nodes: RFNode[], context: CanvasAnnotationContext | undefined = { flowId: 'flow', revisionId: 'r1', syncState: 'saved' }) {
  renderToStaticMarkup(
    <CanvasAnnotationContext.Provider value={context}>
      <SelectionAnnotation nodes={nodes} />
    </CanvasAnnotationContext.Provider>,
  )
}

describe('React Flow selection annotations', () => {
  const attributes = new Map<string, string>()
  beforeEach(() => {
    attributes.clear()
    hooks.state.nodesSelectionActive = true
    hooks.state.userSelectionActive = false
    hooks.state.domNode.querySelector.mockReturnValue({
      setAttribute: (key: string, value: string) => attributes.set(key, value),
      removeAttribute: (key: string) => attributes.delete(key),
    })
  })
  afterEach(() => {
    cleanup()
    for (const store of stores.splice(0)) store.dispose()
  })

  it('annotates the existing rectangle with business IDs and updates the captured context', () => {
    const a = node('a'),
      b = node('b'),
      c = node('c')
    render([a, b])
    expect(hooks.state.domNode.querySelector).toHaveBeenCalledWith('.react-flow__nodesselection-rect')
    expect(attributes.get('oai-annotatable')).toBe('annotation.selectedNodes:2')
    expect(JSON.parse(attributes.get('oai-annotation-metadata')!)).toMatchObject({ nodeIds: '["a","b"]', revisionId: 'r1' })
    cleanup()
    render([b, c], { flowId: 'flow', revisionId: 'r2', syncState: 'dirty' })
    expect(JSON.parse(attributes.get('oai-annotation-metadata')!)).toMatchObject({ nodeIds: '["b","c"]', revisionId: 'r2', syncState: 'dirty' })
    cleanup()
    render([b])
    expect(attributes.size).toBe(0)
  })

  it('does not annotate a live selection gesture or a mixed business/comment selection', () => {
    const a = node('a'),
      b = node('b')
    hooks.state.userSelectionActive = true
    render([a, b])
    expect(attributes.size).toBe(0)
    hooks.state.userSelectionActive = false
    const comment = new CommentNodeStore('comment' as NodeId, { position: { x: 0, y: 0 }, onSaveContent: () => {} })
    stores.push(comment)
    render([a, comment.$.rfNode.value])
    expect(attributes.size).toBe(0)
  })

  it('tolerates an absent rectangle and leaves other DOM attributes unchanged on cleanup', () => {
    const nodes = [node('a'), node('b')]
    attributes.set('tabindex', '-1')
    render(nodes)
    cleanup()
    expect([...attributes]).toEqual([['tabindex', '-1']])
    hooks.state.domNode.querySelector.mockReturnValue(null)
    expect(() => render(nodes)).not.toThrow()
  })
})
