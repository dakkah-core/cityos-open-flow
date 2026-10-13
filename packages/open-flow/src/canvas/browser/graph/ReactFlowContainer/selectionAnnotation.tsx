import type { RFNode } from '../../base/rfHelpers.ts'

import { useStore } from '@xyflow/react'
import { useContext, useLayoutEffect } from 'react'
import { useTranslate } from 'val-i18n-react'
import { NodeStore } from '../../stores/node/node.store.ts'
import { CanvasAnnotationContext, selectionAnnotationMetadata } from '../annotations.tsx'

/** React Flow owns the selection rectangle and exposes no prop for its custom attributes. */
export function SelectionAnnotation({ nodes }: { readonly nodes: readonly RFNode[] }) {
  const context = useContext(CanvasAnnotationContext)
  const root = useStore((state) => state.domNode)
  const active = useStore((state) => state.nodesSelectionActive && !state.userSelectionActive)
  const t = useTranslate()
  const label = t('annotation.selectedNodes', { count: nodes.length })
  const metadata =
    context != null && nodes.every((node) => NodeStore.is(node.data.store))
      ? selectionAnnotationMetadata(
          context,
          nodes.map((node) => node.data.store.nodeId),
          t('annotation.selectionTooLarge'),
        )
      : undefined

  useLayoutEffect(() => {
    if (!active || metadata == null) return
    const target = root?.querySelector('.react-flow__nodesselection-rect')
    if (target == null) return
    target.setAttribute('oai-annotatable', label)
    target.setAttribute('oai-annotation-metadata', metadata)
    return () => {
      target.removeAttribute('oai-annotatable')
      target.removeAttribute('oai-annotation-metadata')
    }
  }, [root, active, label, metadata])

  return null
}
