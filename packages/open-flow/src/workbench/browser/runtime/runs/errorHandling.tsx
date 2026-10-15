import type { Run, RunDetails } from '../api.ts'

import { useContext } from 'react'
import { useTranslate } from 'val-i18n-react'
import { WorkbenchLinkContext } from '../linkContext.ts'

export function ErrorHandling({ run }: { readonly run: Run | RunDetails | undefined }) {
  const t = useTranslate()
  const hrefFor = useContext(WorkbenchLinkContext)
  if (run == null || !('waits' in run) || (run.errorSource == null && run.errorDispatches == null)) return null
  const link = (flowId: string, runId: string, label: string) =>
    hrefFor == null ? (
      <span>
        {label}: {runId}
      </span>
    ) : (
      <a className="text-foreground underline underline-offset-2 hover:text-muted-foreground" href={hrefFor({ flowId, runId, view: 'runs' })}>
        {label}
      </a>
    )
  return (
    <div className="flex flex-col gap-1 px-4 py-2 text-sm" role="status">
      {run.errorSource != null && link(run.errorSource.flowId, run.errorSource.runId, t('errorWorkflow.source'))}
      {run.errorDispatches?.map((dispatch) => (
        <div key={dispatch.flowId}>
          {dispatch.status == 'pending' && (
            <span className="text-muted-foreground">
              {t('errorWorkflow.pending')}: {dispatch.flowId}
            </span>
          )}
          {dispatch.status == 'dispatched' && link(dispatch.flowId, dispatch.runId, `${t('errorWorkflow.dispatched')}: ${dispatch.flowId}`)}
          {dispatch.status == 'failed' && (
            <span className="text-destructive">
              {t('errorWorkflow.failed')} ({dispatch.flowId}): {dispatch.message}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
