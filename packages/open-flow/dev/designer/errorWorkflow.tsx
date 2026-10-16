import type { Flow, RunDetails } from '../../src/workbench/browser/runtime/api.ts'
import type { FrontendStory } from './stories.tsx'

import { useEffect, useMemo, useRef, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { Button } from '../../src/ui/browser/button.tsx'
import { ErrorTriggerSources } from '../../src/workbench/browser/runtime/editor/errorTriggerSources.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { WorkbenchLinkContext } from '../../src/workbench/browser/runtime/linkContext.ts'
import { ErrorHandling } from '../../src/workbench/browser/runtime/runs/errorHandling.tsx'
import { FlowDeletionDialog, FlowDeletionImpact } from '../../src/workbench/browser/runtime/shell/flowDeletionDialog.tsx'
import { useStoryActions } from './storyActions.tsx'

const flows: readonly Flow[] = ['source', 'handler', 'upstream-2', 'offline', 'retiring'].map((flowId) => ({
  flowId,
  name: flowId == 'handler' ? 'Orders · Production payment events and fulfillment updates' : flowId,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  draftRevisionId: 'draft',
  resourceReferences: {
    draft: { variableNames: [], connections: [], errorSourceFlowIds: [] },
    sharedAccess: { accessRevision: 0, providerIds: [], bindings: [] },
  },
  status: flowId == 'retiring' ? 'retiring' : 'active',
  version: 1,
  live: flowId == 'offline' ? undefined : { hasStart: true, enabled: true, publicationId: 'publication', revisionId: 'revision' },
}))
const run: RunDetails = {
  runId: 'source-run',
  flowId: 'source',
  createdAt: '2026-01-01T00:00:00Z',
  finishedAt: '2026-01-01T00:00:01Z',
  status: 'failed',
  source: 'live',
  version: 1,
  revisionId: 'revision',
  publicationId: 'publication',
  closureDigest: 'closure',
  engineContract: 'engine',
  engineDigest: 'engine',
  modelVersion: 5,
  sharedAccessDigest: 'access',
  revisionDigest: 'revision',
  waits: [],
}

const deletionWorkspace = {
  async getFlowReferences() {
    return { version: 1 as const, direction: 'incoming' as const, total: 0, references: [] }
  },
  async getErrorListeners() {
    return [
      { flowId: 'alerts', flowName: 'Incident notifications', nodeId: 'error', nodeName: 'Order failure alerts', enabled: true },
      { flowId: 'ops', flowName: 'Operations', nodeId: 'error', nodeName: 'Flow Error', enabled: false },
    ]
  },
}

function Sample({ dark, language }: { dark: boolean; language: Parameters<FrontendStory['render']>[2] }) {
  const i18n = useMemo(() => createI18n(language), [language])
  useEffect(() => () => i18n.dispose(), [i18n])
  const [value, setValue] = useState<readonly string[]>([])
  const [unavailable, setUnavailable] = useState<readonly string[]>(['handler', 'offline', 'retiring', 'deleted-upstream'])
  const [readOnly, setReadOnly] = useState(false)
  const [deletionOpen, setDeletionOpen] = useState(false)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const deletionTrigger = useRef<HTMLButtonElement>(null)
  useStoryActions([
    { label: readOnly ? 'Enable editing' : 'Read only', onClick: () => setReadOnly(!readOnly) },
    { label: 'Reset', onClick: () => setValue([]) },
  ])
  return (
    <I18nProvider i18n={i18n}>
      <div ref={setContainer} className="open-flow-workbench open-flow-theme grid gap-6 p-6" data-theme={dark ? 'dark' : 'light'}>
        <div className="grid gap-6 md:grid-cols-2">
          <section className="w-full max-w-sm min-w-0 space-y-3">
            <h3>Choose published upstream workflows</h3>
            <ErrorTriggerSources flows={flows} flowId="source" value={value} disabled={readOnly} onChange={setValue} />
          </section>
          <section className="w-full max-w-sm min-w-0 space-y-3">
            <h3>Mixed selection · unavailable upstreams</h3>
            <ErrorTriggerSources flows={flows} flowId="source" value={unavailable} disabled={readOnly} onChange={setUnavailable} />
          </section>
          <section className="w-full max-w-sm min-w-0 space-y-3">
            <h3>No eligible workflow</h3>
            <ErrorTriggerSources flows={[flows[0]!]} flowId="source" value={[]} onChange={setValue} />
          </section>
          <section className="w-full max-w-sm min-w-0 space-y-3">
            <h3>Published snapshot · Read only</h3>
            <ErrorTriggerSources flows={flows} flowId="source" value={['handler']} disabled onChange={setValue} />
          </section>
        </div>
        <section className="space-y-3">
          <h3>Delete workflow · Published listeners</h3>
          <Button ref={deletionTrigger} variant="outline" onClick={() => setDeletionOpen(true)}>
            Preview deletion warning
          </Button>
          {deletionOpen && (
            <FlowDeletionDialog
              flow={{ flowId: 'source', name: 'Orders' }}
              workspace={deletionWorkspace}
              container={container}
              busy={undefined}
              finalFocus={() => deletionTrigger.current}
              onClose={() => setDeletionOpen(false)}
              onDelete={() => setDeletionOpen(false)}
              hrefForFlow={({ flowId }, view) => `?flow=${flowId}&view=${view}`}
              onSelectFlow={() => {}}
            />
          )}

          <FlowDeletionImpact listeners={undefined} failed={false} onRetry={() => {}} />
          <FlowDeletionImpact listeners={undefined} failed onRetry={() => {}} />
        </section>
        <WorkbenchLinkContext.Provider value={({ flowId, runId }) => `?flow=${flowId}&run=${runId}`}>
          <section className="space-y-3">
            <h3>Error handling status</h3>
            <ErrorHandling run={{ ...run, errorDispatches: [{ status: 'pending', flowId: 'handler' }] }} />
            <ErrorHandling run={{ ...run, errorDispatches: [{ status: 'dispatched', flowId: 'handler', runId: 'handler-run' }] }} />
            <ErrorHandling run={{ ...run, errorDispatches: [{ status: 'failed', flowId: 'handler', message: 'The error workflow is disabled.' }] }} />
            <ErrorHandling run={{ ...run, errorSource: { flowId: 'source', runId: 'source-run' } }} />
          </section>
        </WorkbenchLinkContext.Provider>
      </div>
    </I18nProvider>
  )
}

export const errorWorkflowStory: FrontendStory = {
  group: 'Trigger Flow Error',
  id: 'error-workflow',
  title: 'Error handling',
  description:
    'Upstream picker: verify collapsed summaries, search in the main input, repeated selection, the inline clear button, keyboard selection, Escape and outside-click dismissal. Compare deletion, unpublished and read-only states. Remove unavailable upstreams and verify valid selections remain. Preview deletion warnings, including disabled listeners and query failure.',
  standalone: true,
  render: (_log, dark, language) => <Sample dark={dark} language={language} />,
}
