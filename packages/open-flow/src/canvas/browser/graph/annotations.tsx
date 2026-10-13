import { createContext, useContext } from 'react'

export interface CanvasAnnotationContext {
  readonly flowId: string
  /** The saved Draft revision, even while local edits are pending. */
  readonly revisionId: string
  readonly syncState: 'saved' | 'dirty' | 'saving' | 'failed'
}

export const CanvasAnnotationContext = createContext<CanvasAnnotationContext | undefined>(undefined)

interface AnnotationNode {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly kind: string
}

const metadataStringLimit = 256
const metadataByteLimit = 2048
const encoder = new TextEncoder()

function validIdentity(value: string): boolean {
  return value.length > 0 && value.length <= metadataStringLimit
}

function serializeMetadata(metadata: Readonly<Record<string, string | number | undefined>>): string | undefined {
  const text = JSON.stringify(metadata)
  return encoder.encode(text).length <= metadataByteLimit ? text : undefined
}

function excerpt(value: string, limit: number): string {
  if (value.length <= limit) return value
  if (limit <= 1) return ''
  let end = limit - 1
  const last = value.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end--
  return `${value.slice(0, end)}…`
}

/** Keep identities intact; shorten display text to the annotation protocol's limits. */
export function nodeAnnotationMetadata(context: CanvasAnnotationContext, node: AnnotationNode): string | undefined {
  if (![context.flowId, context.revisionId, node.id].every(validIdentity)) return
  const metadata = {
    description: node.description?.trim() ? excerpt(node.description, metadataStringLimit) : undefined,
    flowId: context.flowId,
    revisionId: context.revisionId,
    nodeId: node.id,
    syncState: context.syncState,
  }
  let text = serializeMetadata(metadata)
  while (text == null) {
    if (!metadata.description) return
    metadata.description = excerpt(metadata.description, metadata.description.length - 1) || undefined
    text = serializeMetadata(metadata)
  }
  return text
}

/** Browser annotation fields are scalar values, so the complete ID list is encoded as a JSON string. */
export function selectionAnnotationMetadata(context: CanvasAnnotationContext, nodeIds: readonly string[], tooLarge: string): string | undefined {
  if (nodeIds.length < 2 || ![context.flowId, context.revisionId].every(validIdentity) || nodeIds.some((id) => !id)) return
  const identities = { flowId: context.flowId, revisionId: context.revisionId, syncState: context.syncState }
  const ids = JSON.stringify(nodeIds)
  const text = ids.length <= metadataStringLimit ? serializeMetadata({ ...identities, nodeIds: ids }) : undefined
  return text ?? serializeMetadata({ ...identities, nodeCount: nodeIds.length, error: excerpt(tooLarge, metadataStringLimit) })
}

export function useNodeAnnotation(node: AnnotationNode | undefined) {
  const context = useContext(CanvasAnnotationContext)
  if (context == null || node == null || node.kind == 'comment') return {}
  return {
    'oai-annotatable': node.title,
    'oai-annotation-metadata': nodeAnnotationMetadata(context, node),
  }
}
