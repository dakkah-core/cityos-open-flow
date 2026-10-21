import type { ErrorListener, Flow } from '../api.ts'
import type { WorkspaceBusy } from '../stores/workspaceModel.ts'
import type { WorkspaceStore } from '../stores/workspaceStore.ts'
import type { FlowReferenceNavigation } from './flowReferences.tsx'

import { useEffect, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../../ui/browser/dialog.tsx'
import { FlowReferenceResults, useFlowReferences } from './flowReferences.tsx'

export function FlowDeletionImpact({
  listeners,
  failed,
  onRetry,
}: {
  readonly listeners: readonly ErrorListener[] | undefined
  readonly failed: boolean
  readonly onRetry: () => void
}) {
  const t = useTranslate()
  if (failed)
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm text-destructive">
          {t('sidebar.listenersFailed')}
        </p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t('errorWorkflow.retry')}
        </Button>
      </div>
    )
  if (listeners == null)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('sidebar.listenersLoading')}
      </p>
    )
  if (listeners.length == 0) return null
  return (
    <details className="group rounded-lg border border-border text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 font-medium [&::-webkit-details-marker]:hidden">
        <i aria-hidden="true" className="i-lucide-light:chevron-right shrink-0 text-muted-foreground group-open:rotate-90" />
        <span>{t('flowReferences.deleteListeners', { count: listeners.length })}</span>
      </summary>
      <div className="space-y-3 border-t border-border py-3 pr-3 pl-[calc(1.25rem+1em)]">
        <ul className="m-0 max-h-48 list-none space-y-2 overflow-y-auto p-0">
          {listeners.map((listener) => (
            <li key={`${listener.flowId}/${listener.nodeId}`} className="break-words">
              <span className="font-medium">{listener.flowName}</span> / {listener.nodeName}
              {!listener.enabled && <span className="ml-2 text-muted-foreground">{t('sidebar.listenerDisabled')}</span>}
            </li>
          ))}
        </ul>
        <p className="m-0 text-muted-foreground">{t('sidebar.listenersImpact')}</p>
      </div>
    </details>
  )
}

export function FlowDeletionDialog({
  flow,
  workspace,
  container,
  busy,
  finalFocus,
  onClose,
  onDelete,
  ...navigation
}: FlowReferenceNavigation & {
  readonly flow: Pick<Flow, 'flowId' | 'name'>
  readonly workspace: Pick<WorkspaceStore, 'getErrorListeners' | 'getFlowReferences'>
  readonly container: HTMLElement | null
  readonly busy: WorkspaceBusy | undefined
  readonly finalFocus: () => HTMLButtonElement | null
  readonly onClose: () => void
  readonly onDelete: () => void
}) {
  const t = useTranslate()
  const cancel = useRef<HTMLButtonElement>(null)
  const references = useFlowReferences(flow.flowId, workspace)
  const [listeners, setListeners] = useState<readonly ErrorListener[]>()
  const [listenerStatus, setListenerStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setListeners(undefined)
    setListenerStatus('loading')
    void workspace.getErrorListeners(flow.flowId, controller.signal).then(
      (value) => {
        if (controller.signal.aborted) return
        setListeners(value)
        setListenerStatus('ready')
      },
      () => {
        if (!controller.signal.aborted) setListenerStatus('failed')
      },
    )
    return () => controller.abort()
  }, [flow.flowId, workspace, attempt])
  const hasReferences = references.result != null && references.result.total > 0
  const canDelete = busy == null && references.status == 'ready' && listenerStatus == 'ready'
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && busy == null) onClose()
      }}
    >
      <DialogContent
        container={container}
        initialFocus={cancel}
        finalFocus={finalFocus}
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto]"
      >
        <DialogHeader>
          <DialogTitle className="break-words leading-snug">{t('sidebar.deleteFlowConfirm', { name: flow.name })}</DialogTitle>
          <DialogDescription>{t('resource.deleteDescription')}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-2 overflow-y-auto">
          <FlowReferenceResults
            state={references}
            disabled={busy != null}
            showEmpty={false}
            summary={hasReferences ? t('flowReferences.deleteImpact', { count: references.result!.total }) : undefined}
            {...navigation}
          />
          <FlowDeletionImpact
            listeners={listeners}
            failed={listenerStatus == 'failed'}
            onRetry={() => {
              setListenerStatus('loading')
              setAttempt((value) => value + 1)
            }}
          />
        </div>
        <DialogFooter>
          <Button ref={cancel} variant="outline" disabled={busy != null} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!canDelete} onClick={onDelete} variant="destructive">
            {t(busy == 'flow' ? 'common.deleting' : hasReferences ? 'flowReferences.deleteAnyway' : 'common.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
