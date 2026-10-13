import type { CanvasAnnotationContext } from '../../../../canvas/browser/graph/annotations.tsx'
import type { Draft } from '../api.ts'
import type { ModuleEditorStatus, WorkspaceStatus } from '../stores/workspaceModel.ts'

export function canvasAnnotations(
  flowId: string | undefined,
  draft: Pick<Draft, 'flowId' | 'revisionId'> | undefined,
  status: WorkspaceStatus,
  moduleStatus: ModuleEditorStatus | undefined,
  saveFailed: boolean,
): CanvasAnnotationContext | undefined {
  if (flowId == null || draft == null || draft.flowId != flowId || status == 'loading' || status == 'noDraft') return
  return {
    flowId,
    revisionId: draft.revisionId,
    syncState:
      saveFailed || status == 'failed' || moduleStatus == 'failed'
        ? 'failed'
        : status == 'saving' || moduleStatus == 'saving'
          ? 'saving'
          : moduleStatus == 'dirty'
            ? 'dirty'
            : 'saved',
  }
}
