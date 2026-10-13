import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CanvasAnnotationContext, nodeAnnotationMetadata, selectionAnnotationMetadata, useNodeAnnotation } from './annotations.tsx'

const context: CanvasAnnotationContext = { flowId: 'flow', revisionId: 'r1', syncState: 'saved' }
const node = { id: 'node', title: 'Summary', description: 'Summarize orders.', kind: 'task' }

function Target({ id = 'node', title = 'Summary', kind = 'task' }: { id?: string; title?: string; kind?: string }) {
  const annotation = useNodeAnnotation({ ...node, id, title, kind })
  return <div {...annotation} />
}

describe('Annotation metadata contract', () => {
  it('exposes display text, intact identities, and sync state without duplicate title or page URL fields', () => {
    expect(JSON.parse(nodeAnnotationMetadata(context, node)!)).toEqual({
      description: 'Summarize orders.',
      flowId: 'flow',
      revisionId: 'r1',
      nodeId: 'node',
      syncState: 'saved',
    })
  })

  it.each([undefined, '', '  \n\t  '])('omits an empty description (%j) without placeholder text', (description) => {
    expect(JSON.parse(nodeAnnotationMetadata(context, { ...node, description })!)).toEqual({
      flowId: 'flow',
      revisionId: 'r1',
      nodeId: 'node',
      syncState: 'saved',
    })
  })

  it('shortens descriptions to 256 characters without splitting surrogate pairs', () => {
    const metadata = JSON.parse(
      nodeAnnotationMetadata(context, {
        ...node,
        description: 'x'.repeat(254) + '😀more',
      })!,
    )
    expect(metadata.description).toBe('x'.repeat(254) + '…')
    expect(metadata).toMatchObject({ flowId: 'flow', revisionId: 'r1', nodeId: 'node' })
    expect(JSON.parse(nodeAnnotationMetadata(context, { ...node, description: 'x'.repeat(256) })!).description).toHaveLength(256)
  })

  it('validates each identity length without truncating any identity', () => {
    expect(nodeAnnotationMetadata(context, { ...node, id: 'x'.repeat(256) })).toBeDefined()
    expect(nodeAnnotationMetadata(context, { ...node, id: 'x'.repeat(257) })).toBeUndefined()
    expect(nodeAnnotationMetadata(context, { ...node, id: '' })).toBeUndefined()
    expect(nodeAnnotationMetadata({ ...context, flowId: '' }, node)).toBeUndefined()
    expect(nodeAnnotationMetadata({ ...context, revisionId: '' }, node)).toBeUndefined()
  })

  it('omits metadata when intact identities exceed the total byte budget', () => {
    const id = '界'.repeat(256)
    expect(nodeAnnotationMetadata({ ...context, flowId: id, revisionId: id }, { ...node, id })).toBeUndefined()
  })

  it('shortens descriptions to fit the serialized UTF-8 byte budget', () => {
    const unicode = '界'.repeat(250)
    const text = nodeAnnotationMetadata({ ...context, flowId: unicode }, { ...node, id: '界'.repeat(248), description: unicode })!
    const metadata = JSON.parse(text)
    expect(metadata.description.length).toBeLessThan(unicode.length)
    expect(metadata.description.endsWith('…')).toBe(true)
    expect(metadata).toMatchObject({ flowId: unicode, revisionId: 'r1', nodeId: '界'.repeat(248) })
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(2048)
  })
})

const render = (value: CanvasAnnotationContext, title: string) =>
  renderToStaticMarkup(
    <CanvasAnnotationContext.Provider value={value}>
      <Target title={title} />
    </CanvasAnnotationContext.Provider>,
  )

describe('Multi-node annotation metadata', () => {
  it('preserves every node ID in a scalar JSON string with shared Flow and revision identities', () => {
    const ids = ['trigger', 'task,with,commas', 'node"quoted']
    const metadata = JSON.parse(selectionAnnotationMetadata(context, ids, 'Select fewer nodes.')!)
    expect(metadata).toEqual({ ...context, nodeIds: JSON.stringify(ids) })
    expect(JSON.parse(metadata.nodeIds)).toEqual(ids)
    expect(selectionAnnotationMetadata(context, ['single'], 'Select fewer nodes.')).toBeUndefined()
  })

  it.each([{ ids: Array.from({ length: 40 }, (_, index) => `node-${index}`) }, { ids: ['short', 'x'.repeat(257)] }])(
    'reports an oversized selection without sending a partial list',
    ({ ids }) => {
      expect(JSON.parse(selectionAnnotationMetadata(context, ids, 'Select fewer nodes.')!)).toEqual({
        ...context,
        nodeCount: ids.length,
        error: 'Select fewer nodes.',
      })
    },
  )

  it('distinguishes missing identity from a valid selection exceeding the UTF-8 byte budget', () => {
    expect(selectionAnnotationMetadata(context, ['valid', ''], 'Select fewer nodes.')).toBeUndefined()
    expect(selectionAnnotationMetadata({ ...context, flowId: '' }, ['a', 'b'], 'Select fewer nodes.')).toBeUndefined()
    const value = { ...context, flowId: '界'.repeat(256), revisionId: '界'.repeat(256) }
    const metadata = selectionAnnotationMetadata(value, ['界'.repeat(125), '界'.repeat(124)], 'Select fewer nodes.')!
    expect(JSON.parse(metadata)).toEqual({ ...value, nodeCount: 2, error: 'Select fewer nodes.' })
    expect(new TextEncoder().encode(metadata).length).toBeLessThanOrEqual(2048)
  })
})

describe('Annotation attributes', () => {
  it('renders the protocol attributes with escaped names and updated context', () => {
    expect(render(context, 'Summary "A"')).toContain('oai-annotatable="Summary &quot;A&quot;"')
    const updated = render({ ...context, flowId: 'other', revisionId: 'r2', syncState: 'dirty' }, 'Renamed')
    expect(updated).toContain('oai-annotatable="Renamed"')
    expect(updated).toContain('&quot;flowId&quot;:&quot;other&quot;')
    expect(updated).toContain('&quot;revisionId&quot;:&quot;r2&quot;')
    expect(updated).toContain('&quot;nodeId&quot;:&quot;node&quot;')
    expect(updated).not.toContain('&quot;title&quot;:')
    expect(updated).toContain('&quot;description&quot;:&quot;Summarize orders.&quot;')
    expect(updated).toContain('&quot;syncState&quot;:&quot;dirty&quot;')
  })

  it('does not attach node semantics to comments or canvases without context', () => {
    expect(renderToStaticMarkup(<Target />)).not.toContain('oai-')
    expect(
      renderToStaticMarkup(
        <CanvasAnnotationContext.Provider value={context}>
          <Target kind="comment" />
        </CanvasAnnotationContext.Provider>,
      ),
    ).not.toContain('oai-')
  })

  it('retains a human-readable target when its identity exceeds the metadata limit', () => {
    const markup = renderToStaticMarkup(
      <CanvasAnnotationContext.Provider value={context}>
        <Target id={'x'.repeat(257)} />
      </CanvasAnnotationContext.Provider>,
    )
    expect(markup).toContain('oai-annotatable="Summary"')
    expect(markup).not.toContain('oai-annotation-metadata')
  })
})
