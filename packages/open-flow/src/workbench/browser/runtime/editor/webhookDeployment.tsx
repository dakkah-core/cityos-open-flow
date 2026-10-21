import type { TriggerBinding } from '../api.ts'
import type { TriggerBindingsState } from '../publications/publicationStore.ts'
import type { SetNotice } from '../stores/workbenchNotice.ts'

import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { TriggerStatus } from '../publications/triggerStatus.tsx'
import { WebhookCopyButton } from '../publications/webhookEndpoint.tsx'
import { InspectorSection } from './inspectorSection.tsx'

export interface WebhookDeploymentProps {
  readonly notify: SetNotice
  readonly binding?: TriggerBinding
  readonly status: TriggerBindingsState['status']
  readonly enabled: boolean
  readonly hasUnpublishedChanges: boolean
  readonly onRetry: () => void
}

export function WebhookDeployment({ binding, status, enabled, hasUnpublishedChanges, onRetry, notify }: WebhookDeploymentProps) {
  const t = useTranslate()
  const current = binding?.currentPublicationId != null
  const ready = status === 'loaded' && current
  return (
    <InspectorSection
      title={
        <span className="flex w-full items-center justify-between gap-2">
          <span className="flex flex-wrap items-center gap-2">
            <span>{t('webhookDeployment.title')}</span>
            {ready && <TriggerStatus binding={binding} enabled={enabled} />}
          </span>
          {ready && binding.endpointUrl != null && <WebhookCopyButton notify={notify} key={binding.endpointUrl} endpointUrl={binding.endpointUrl} iconOnly />}
        </span>
      }
    >
      <div className="flex min-w-0 flex-col gap-2 text-xs">
        {status === 'failed' ? (
          <div className="flex items-center justify-between gap-2" role="status">
            <span className="text-muted-foreground">{t('webhookDeployment.loadFailed')}</span>
            <Button size="sm" variant="outline" onClick={onRetry}>
              {t('connectorAccess.retry')}
            </Button>
          </div>
        ) : status !== 'loaded' ? (
          <p className="m-0 text-muted-foreground" role="status">
            {t('publication.loadingTrigger')}
          </p>
        ) : !current ? (
          <p className="m-0 text-muted-foreground">{t('webhookDeployment.unpublished')}</p>
        ) : (
          <>
            {binding.endpointUrl != null ? (
              <code className="min-w-0 select-text break-all text-foreground text-xs leading-5">{binding.endpointUrl}</code>
            ) : (
              <p className="m-0 text-muted-foreground">{t('webhookDeployment.pending')}</p>
            )}
            {hasUnpublishedChanges && <p className="m-0 text-muted-foreground">{t('webhookDeployment.unpublishedChanges')}</p>}
          </>
        )}
      </div>
    </InspectorSection>
  )
}
