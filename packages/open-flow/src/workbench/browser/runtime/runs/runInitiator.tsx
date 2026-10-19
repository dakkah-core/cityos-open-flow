import type { Run, RunDetails } from '../api.ts'

import { useTranslate } from 'val-i18n-react'

export function RunInitiator({ run }: { readonly run: Run | RunDetails }) {
  const t = useTranslate()
  if (!('waits' in run)) return null
  const initiator = run.initiator
  const actor = initiator?.actorId ?? t(initiator?.channel == 'trigger' ? 'run.initiatorSystem' : 'run.initiatorUnknown')
  return (
    <dl className="m-0 flex shrink-0 flex-wrap gap-x-6 gap-y-1 px-4 py-2 text-xs text-muted-foreground">
      <div className="flex min-w-0 gap-2">
        <dt className="shrink-0">{t('run.initiatorUser')}</dt>
        <dd className="m-0 break-all text-foreground">{actor}</dd>
      </div>
      <div className="flex gap-2">
        <dt className="shrink-0">{t('run.initiatorChannel')}</dt>
        <dd className="m-0 text-foreground">{initiator == null ? t('run.initiatorUnknown') : t(`run.channelLabels.${initiator.channel}`)}</dd>
      </div>
    </dl>
  )
}
