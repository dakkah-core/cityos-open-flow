import type { WorkflowReferences } from '../../../../workflow/common/workflow.ts'
import type { Flow } from '../api.ts'
import type { WorkbenchView } from '../contract.ts'
import type { FlowCatalogItem } from '../stores/flowCatalog.ts'
import type { WorkspaceStore } from '../stores/workspaceStore.ts'

import { useEffect, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '../../../../ui/browser/popover.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/browser/tooltip.tsx'
import { followWorkbenchLink } from '../navigationLink.ts'

export interface FlowReferenceNavigation {
  readonly hrefForFlow: (flow: Pick<Flow, 'flowId'>, view?: WorkbenchView) => string
  readonly onSelectFlow: (flow: Pick<Flow, 'flowId'>, view?: WorkbenchView) => void
}

interface QueryProps extends FlowReferenceNavigation {
  readonly flowId: string
  readonly workspace: Pick<WorkspaceStore, 'getFlowReferences'>
}

export function useFlowReferences(flowId: string, workspace: Pick<WorkspaceStore, 'getFlowReferences'>) {
  const [result, setResult] = useState<WorkflowReferences>()
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [offset, setOffset] = useState(0)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setStatus('loading')
    void workspace.getFlowReferences(flowId, { offset, signal: controller.signal }).then(
      (page) => {
        if (controller.signal.aborted) return
        setResult((previous) => {
          const references = new Map((offset == 0 ? [] : (previous?.references ?? [])).map((item) => [item.flowId, item]))
          for (const item of page.references) references.set(item.flowId, item)
          return { ...page, references: [...references.values()] }
        })
        setStatus('ready')
      },
      () => {
        if (controller.signal.aborted) return
        setStatus('failed')
      },
    )
    return () => controller.abort()
  }, [workspace, flowId, offset, attempt])
  return {
    result,
    status,
    retry: () => {
      setStatus('loading')
      setAttempt((value) => value + 1)
    },
    loadMore: () => {
      if (status != 'ready' || result?.nextOffset == null) return
      setStatus('loading')
      setOffset(result.nextOffset)
    },
  }
}

function FlowReferenceQuery({ flowId, workspace, ...navigation }: QueryProps) {
  return <FlowReferenceResults state={useFlowReferences(flowId, workspace)} {...navigation} />
}

export function FlowReferenceResults({
  state,
  hrefForFlow,
  onSelectFlow,
  showEmpty = true,
  summary,
  disabled = false,
}: FlowReferenceNavigation & {
  readonly state: ReturnType<typeof useFlowReferences>
  readonly summary?: string
  readonly showEmpty?: boolean
  readonly disabled?: boolean
}) {
  const t = useTranslate()
  const { result, status } = state
  const list = result != null && result.references.length > 0 && (
    <div className="space-y-3">
      <ul className="m-0 max-h-64 list-none space-y-3 overflow-y-auto p-0">
        {result.references.map((item) => {
          const defaultView = item.draft ? 'design' : 'publications'
          return (
            <li key={item.flowId} className="flex items-start justify-between gap-3">
              <a
                className="flex min-w-0 items-start gap-2 text-foreground no-underline hover:underline"
                href={hrefForFlow(item, defaultView)}
                onClick={(event) => followWorkbenchLink(event, () => onSelectFlow(item, defaultView))}
              >
                <i aria-hidden="true" className="i-lucide-light:workflow mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 break-words">{item.name ?? item.flowId}</span>
              </a>
              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                {item.draft && (
                  <a
                    className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground no-underline hover:underline"
                    href={hrefForFlow(item, 'design')}
                    onClick={(event) => followWorkbenchLink(event, () => onSelectFlow(item, 'design'))}
                  >
                    {t('flowReferences.draft')}
                  </a>
                )}
                {item.live != null && (
                  <a
                    className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground no-underline hover:underline"
                    href={hrefForFlow(item, 'publications')}
                    onClick={(event) => followWorkbenchLink(event, () => onSelectFlow(item, 'publications'))}
                  >
                    {t('flowReferences.live')}
                    {!item.live.enabled && ` · ${t('flowReferences.disabled')}`}
                  </a>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {status != 'failed' && result?.nextOffset != null && (
        <Button variant="outline" size="sm" disabled={disabled || status == 'loading'} onClick={state.loadMore}>
          {t('flowReferences.loadMore')}
        </Button>
      )}
    </div>
  )
  return (
    <div className="space-y-3 text-sm">
      {summary != null && list ? (
        <details className="group rounded-lg border border-border">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
            <i aria-hidden="true" className="i-lucide-light:chevron-right shrink-0 text-muted-foreground group-open:rotate-90" />
            <span>{summary}</span>
          </summary>
          <div className="border-t border-border py-3 pr-3 pl-[calc(1.25rem+1em)]">{list}</div>
        </details>
      ) : (
        list
      )}
      {status == 'loading' && (
        <p className="m-0 text-muted-foreground" role="status">
          {t('flowReferences.loading')}
        </p>
      )}
      {status == 'failed' && (
        <div className="space-y-2" role="alert">
          <p className="m-0 text-muted-foreground">{t('flowReferences.failed')}</p>
          <Button variant="outline" size="sm" disabled={disabled} onClick={state.retry}>
            {t('flowReferences.retry')}
          </Button>
        </div>
      )}
      {showEmpty && status == 'ready' && result?.references.length == 0 && <p className="m-0 text-muted-foreground">{t('flowReferences.empty')}</p>}
    </div>
  )
}

interface ButtonProps extends FlowReferenceNavigation {
  readonly flow: FlowCatalogItem
  readonly workspace: Pick<WorkspaceStore, 'getFlowReferences'>
  readonly container: HTMLElement | null
}

export function FlowReferencesButton(props: ButtonProps) {
  const referenceCount = props.flow.referenceCount
  if (referenceCount == null || referenceCount == 0) return null
  return <FlowReferencesPopover key={props.flow.flowId} {...props} referenceCount={referenceCount} />
}

function FlowReferencesPopover({ flow, referenceCount, workspace, container, hrefForFlow, onSelectFlow }: ButtonProps & { readonly referenceCount: number }) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const label = t('flowReferences.count', { count: referenceCount })
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger render={<PopoverTrigger render={<Button aria-label={label} variant="ghost" size="sm" className="text-muted-foreground" />} />}>
          <i aria-hidden="true" className="i-lucide-light:link" />
          <span>{referenceCount}</span>
        </TooltipTrigger>
        <TooltipContent container={container} collisionBoundary={[]} positionMethod="fixed">
          {label}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        container={container}
        collisionBoundary={[]}
        positionMethod="fixed"
        align="end"
        className="w-96 max-w-[calc(100vw-2rem)] max-h-(--available-height) overflow-y-auto gap-4 p-4"
      >
        <PopoverTitle className="break-words text-base font-semibold">{t('flowReferences.title', { name: flow.name })}</PopoverTitle>
        {open && <FlowReferenceQuery flowId={flow.flowId} workspace={workspace} hrefForFlow={hrefForFlow} onSelectFlow={onSelectFlow} />}
      </PopoverContent>
    </Popover>
  )
}
