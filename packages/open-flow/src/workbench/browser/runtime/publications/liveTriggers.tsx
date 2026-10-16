import type { ReactElement } from 'react'
import type { TFunction } from 'val-i18n'
import type { TriggerActivityKind, TriggerBinding } from '../api.ts'
import type { RevisionView } from '../revisionView.ts'
import type { WorkbenchStore } from '../stores/workbenchStore.ts'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useLang, useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Dialog, DialogContent, DialogTitle } from '../../../../ui/browser/dialog.tsx'
import { collapseAllNested, JSONViewer } from '../../../../ui/browser/json-viewer/index.ts'
import { ListenerHealth, TriggerStatus, triggerClass, triggerLabel } from './triggerStatus.tsx'
import { WebhookEndpoint } from './webhookEndpoint.tsx'

function activityLabel(kind: TriggerActivityKind, t: TFunction): string {
  switch (kind) {
    case 'delivery.failed':
      return t('publication.activityDeliveryFailed')
    case 'health.failed':
      return t('publication.activityHealthFailed')
    case 'health.needs_reauth':
      return t('publication.activityHealthNeedsReauth')
    case 'health.recovered':
      return t('publication.activityHealthRecovered')
    case 'health.suspended':
      return t('publication.activityHealthSuspended')
    case 'operator.paused':
      return t('publication.activityOperatorPaused')
    case 'operator.resumed':
      return t('publication.activityOperatorResumed')
  }
}

function triggerName(binding: TriggerBinding, revision: RevisionView | undefined): string {
  if (revision == null || binding.currentRevisionId != revision.revision.revisionId) return binding.triggerNodeId
  return revision.trigger(binding.triggerNodeId)?.name ?? binding.triggerNodeId
}

export function LiveTriggers({ store }: { readonly store: WorkbenchStore }): ReactElement {
  const language = useLang()
  const t = useTranslate()
  const activities = useVal(store.publications.$.activities)
  const activitiesLoadFailed = useVal(store.publications.$.activitiesLoadFailed)
  const activitiesLoading = useVal(store.publications.$.activitiesLoading)
  const activitiesLoadingMore = useVal(store.publications.$.activitiesLoadingMore)
  const activitiesNextCursor = useVal(store.publications.$.activitiesNextCursor)
  const { bindings } = useVal(store.publications.$.bindings)
  const detail = useVal(store.publications.$.detail)
  const detailLoading = useVal(store.publications.$.detailLoading)
  const selectedTriggerId = useVal(store.publications.$.selectedTriggerId)
  const testingTriggerId = useVal(store.publications.$.testingTriggerId)
  const testResult = useVal(store.publications.$.testResult)
  const live = useVal(store.workspace.$.live)
  const enabled = live?.status == 'runnable'
  const revision = useVal(store.workspace.$.revision)
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  const portal = useCallback((element: HTMLElement | null) => setRoot(element?.closest<HTMLElement>('.open-flow-workbench') ?? null), [])
  useEffect(() => () => store.publications.closeTrigger(), [store])
  const selected = bindings.find((binding) => binding.triggerNodeId == selectedTriggerId)
  return (
    <section className="publication-triggers" ref={portal} aria-label={t('publication.triggers')}>
      <header className="trigger-list-header">
        <h3>{t('publication.triggers')}</h3>
      </header>
      {bindings.length == 0 ? (
        <p className="publication-trigger-empty">{t('publication.triggerEmpty')}</p>
      ) : (
        <ul className="trigger-binding-list">
          {bindings.map((binding) => {
            return (
              <li className="trigger-binding-row" key={binding.triggerNodeId}>
                <Button
                  className="trigger-binding-open"
                  aria-haspopup="dialog"
                  onClick={(event) => {
                    opener.current = event.currentTarget
                    void store.publications.openTrigger(binding.triggerNodeId)
                  }}
                  variant="ghost"
                  size="sm"
                >
                  <span className={`status-dot mr-1 ${triggerClass(binding, enabled)}`} />
                  <span className="trigger-binding-label">
                    <span className="trigger-binding-name" title={binding.triggerNodeId}>
                      {triggerName(binding, revision)}
                    </span>
                    <span className="trigger-binding-kind">{binding.kind}</span>
                  </span>
                </Button>
                <TriggerStatus binding={binding} enabled={enabled} />
              </li>
            )
          })}
        </ul>
      )}
      <Dialog
        open={selectedTriggerId != null}
        onOpenChange={(open) => {
          if (!open) store.publications.closeTrigger()
        }}
      >
        <DialogContent
          container={root}
          finalFocus={opener}
          closeLabel={t('common.close')}
          className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-[min(42rem,calc(100%-2rem))]"
        >
          <DialogTitle className="pr-8 break-words">{selected == null ? selectedTriggerId : triggerName(selected, revision)}</DialogTitle>
          <div className="trigger-binding-detail">
            {detailLoading ? (
              <p role="status">{t('publication.loadingTrigger')}</p>
            ) : detail != null ? (
              <>
                <dl>
                  <div>
                    <dt>{t('publication.triggerKind')}</dt>
                    <dd>{detail.binding.kind}</dd>
                  </div>
                  <div>
                    <dt>{t('publication.runtimeVersion')}</dt>
                    <dd>{detail.binding.runtimeVersion}</dd>
                  </div>
                  <div>
                    <dt>{t('publication.triggerHealth')}</dt>
                    <dd>{triggerLabel(detail.binding, enabled, t)}</dd>
                  </div>
                  <div>
                    <dt>{t('publication.updatedAt')}</dt>
                    <dd>{new Date(detail.binding.updatedAt).toLocaleString(language)}</dd>
                  </div>
                  {detail.binding.lastErrorCode != null && (
                    <div>
                      <dt>{t('publication.lastError')}</dt>
                      <dd>{detail.binding.lastErrorCode}</dd>
                    </div>
                  )}
                </dl>
                <ListenerHealth binding={detail.binding} enabled={enabled} />
                {detail.binding.health == 'needs_reauth' && <p className="trigger-recovery">{t('publication.needsReauthDescription')}</p>}
                {detail.binding.endpointUrl != null && (
                  <div className="trigger-webhook">
                    <span>{t('publication.webhookUrl')}</span>
                    <WebhookEndpoint notify={store.workspace.notify} key={detail.binding.endpointUrl} endpointUrl={detail.binding.endpointUrl} />
                  </div>
                )}
                <div className="trigger-binding-detail-sections">
                  {detail.binding.kind == 'poll' && detail.binding.currentPublicationId != null && (
                    <section className="trigger-test">
                      <header>
                        <div>
                          <h3>{t('publication.pollTest')}</h3>
                          <p>{t('publication.pollTestDescription')}</p>
                        </div>
                        <Button disabled={testingTriggerId != null} onClick={() => void store.publications.testTrigger()} size="sm" variant="outline">
                          {t(testingTriggerId == detail.binding.triggerNodeId ? 'publication.pollTesting' : 'publication.pollTest')}
                        </Button>
                      </header>
                      {testResult != null && (
                        <div className="trigger-test-result">
                          <strong>{t('publication.pollTestResult')}</strong>
                          <div className="trigger-test-summary">
                            <span>{t('publication.pollTestEvents', { count: testResult.events.length })}</span>
                            <span>{t('publication.pollTestFiltered', { count: testResult.filtered })}</span>
                            {testResult.hasMore && <span>{t('publication.pollTestHasMore')}</span>}
                          </div>
                          {testResult.events.length == 0 ? (
                            <p>{t('publication.pollTestNoEvents')}</p>
                          ) : (
                            <div className="trigger-test-events">
                              <JSONViewer data={testResult.events} shouldExpandNode={collapseAllNested} />
                            </div>
                          )}
                        </div>
                      )}
                    </section>
                  )}
                  <section className="trigger-activities">
                    <h3>{t('publication.activities')}</h3>
                    {activitiesLoading ? (
                      <div className="trigger-activities-empty">{t('publication.loadingTriggerActivities')}</div>
                    ) : activities.length == 0 ? (
                      <div className="trigger-activities-empty">
                        {t(activitiesLoadFailed ? 'publication.activitiesLoadFailed' : 'publication.activitiesEmpty')}
                      </div>
                    ) : (
                      <div className="trigger-activity-list">
                        {activities.map((activity) => (
                          <div className="trigger-activity" key={activity.activityId}>
                            <span className="status-dot neutral" />
                            <div>
                              <strong>{activityLabel(activity.kind, t)}</strong>
                              {activity.errorCode != null && <code>{activity.errorCode}</code>}
                              {activity.errorMessage != null && <p className="trigger-activity-message">{activity.errorMessage}</p>}
                            </div>
                            <time dateTime={activity.createdAt}>{new Date(activity.createdAt).toLocaleString(language)}</time>
                          </div>
                        ))}
                      </div>
                    )}
                    {(activitiesNextCursor != null || activitiesLoadFailed) && !activitiesLoading && (
                      <Button
                        className="trigger-activities-more"
                        disabled={activitiesLoadingMore}
                        onClick={() =>
                          void (activitiesNextCursor == null
                            ? store.publications.openTrigger(detail.binding.triggerNodeId)
                            : store.publications.loadMoreTriggerActivities())
                        }
                        size="sm"
                        variant="outline"
                      >
                        {t(
                          activitiesLoadingMore
                            ? 'publication.loadingTriggerActivities'
                            : activitiesLoadFailed
                              ? 'empty.retry'
                              : 'publication.loadMoreActivities',
                        )}
                      </Button>
                    )}
                  </section>
                </div>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (selectedTriggerId != null) void store.publications.openTrigger(selectedTriggerId)
                }}
              >
                {t('empty.retry')}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
