import type { Flow } from '../../src/control/common/api.ts'
import type { WorkflowFile } from '../../src/flow/common/workflowFile.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { OpenFlowWorkbenchHandle } from '../../src/workbench/browser/runtime/contract.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useEffect, useRef, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { WorkbenchClient } from '../../src/workbench/browser/runtime/api.ts'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { FlowBrowser } from '../../src/workbench/browser/runtime/shell/resourceBrowser.tsx'
import { WorkbenchStore } from '../../src/workbench/browser/runtime/stores/workbenchStore.ts'
import { useStoryActions } from './storyActions.tsx'

const sampleWorkflow: WorkflowFile = {
  kind: 'open-flow-workflow',
  version: 1,
  name: 'Sample workflow',
  content: {
    modelVersion: 6,
    modules: {},
    document: { bindings: {}, graph: { nodes: { start: { inputDefs: [], kind: 'start', name: 'Start' } }, edges: [] } },
  },
  presentation: {},
}
const sampleText = JSON.stringify({ ...sampleWorkflow, name: 'GitHub sample' })

function FlowBrowserStory({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const importRef = useRef<OpenFlowWorkbenchHandle>(null)
  const [referenceFailure, setReferenceFailure] = useState<'none' | 'initial' | 'next'>('none')
  const referenceFailureRef = useRef(referenceFailure)
  referenceFailureRef.current = referenceFailure
  const [teamState, setTeamState] = useState<'ready' | 'loading' | 'disabled'>('ready')
  const [failImport, setFailImport] = useState(false)
  const [single, setSingle] = useState(false)
  const [embedded, setEmbedded] = useState(false)
  const [teams, setTeams] = useState(false)
  const [empty, setEmpty] = useState(false)
  const [initializing, setInitializing] = useState(false)
  const [connected, setConnected] = useState(false)
  const [session, setSession] = useState<{ connect: () => void; i18n: ReturnType<typeof createI18n>; store: WorkbenchStore }>()
  useStoryActions([
    { label: referenceFailure == 'initial' ? 'Initial failure armed' : 'Fail initial reference request', onClick: () => setReferenceFailure('initial') },
    { label: referenceFailure == 'next' ? 'Next-page failure armed' : 'Fail next reference page', onClick: () => setReferenceFailure('next') },
    {
      label: 'Import external file',
      onClick: () =>
        log(
          'import.open',
          importRef.current?.openImport({ text: sampleText, fileName: 'demo.openflow.json', sourceUrl: 'https://github.com/oomol-lab/open-flow' }),
        ),
    },
    { label: 'Import invalid file', onClick: () => log('import.open', importRef.current?.openImport({ text: '{}' })) },
    { label: failImport ? 'Allow import submission' : 'Fail import submission', onClick: () => setFailImport(!failImport) },
    { label: 'Team: ' + teamState, onClick: () => setTeamState(teamState == 'ready' ? 'loading' : teamState == 'loading' ? 'disabled' : 'ready') },
    {
      label: single ? 'Show status examples' : 'Show single workflow',
      onClick: () => {
        setSingle(!single)
        setTeams(true)
        setEmbedded(true)
      },
    },
    { label: embedded ? 'Standalone layout' : 'Embedded layout', onClick: () => setEmbedded(!embedded) },
    { label: teams ? 'Hide teams' : 'Show teams', onClick: () => setTeams(!teams) },
    { label: empty ? 'Show workflows' : 'Show empty list', onClick: () => setEmpty(!empty) },
    { label: initializing ? 'Finish startup' : 'Show startup', onClick: () => setInitializing(!initializing) },
    {
      label: 'Connect notifications',
      disabled: session == null || connected,
      onClick: () => {
        session?.connect()
        setConnected(true)
      },
    },
  ])
  useEffect(() => {
    setConnected(false)
    const connection = Promise.withResolvers<void>()
    const i18n = createI18n(language)
    const flows: Flow[] = (single ? ['xxx'] : ['Published flow', 'Unpublished changes with a long flow name', 'Disabled flow', 'Draft flow']).map(
      (name, index) => {
        const flow: Flow = {
          flowId: single ? 'flow_7a7ca0123456789abcdef67e0dd' : `flow-list-sample-${index}`,
          name,
          createdAt: '2026-09-24T09:00:00.000Z',
          updatedAt: '2026-09-24T09:00:00.000Z',
          draftRevisionId: 'draft',
          resourceReferences: {
            draft: { variableNames: [], connections: [], errorSourceFlowIds: [] },
            sharedAccess: { accessRevision: 0, providerIds: [], bindings: [] },
          },
          status: 'active',
          version: 1,
        }
        return index == 3
          ? flow
          : Object.assign(flow, {
              live: { hasStart: true, enabled: index != 2, publicationId: `publication-${index}`, revisionId: index == 1 ? 'previous' : 'draft' },
            })
      },
    )
    let reads = 0
    const client = new WorkbenchClient(
      async (path, init) => {
        const url = String(path).split('?')[0]!
        const index = flows.findIndex((flow) => url == `/v1/flows/${flow.flowId}` || url == `/v1/flows/${flow.flowId}/enabled`)
        const flow = flows[index]
        if (flow != null && init?.method == 'PATCH') {
          const { name } = JSON.parse(String(init.body)) as { name: string }
          flows[index] = { ...flow, name }
          log('flow.rename', name)
          return Response.json(flows[index])
        }
        if (flow?.live != null && init?.method == 'PUT' && url.endsWith('/enabled')) {
          const { enabled } = JSON.parse(String(init.body)) as { enabled: boolean }
          flows[index] = { ...flow, live: { ...flow.live, enabled } }
          log('flow.enabled', enabled)
          return Response.json(flows[index])
        }
        if (url.endsWith('/references')) {
          await Promise.resolve()
          init?.signal?.throwIfAborted()
          const offset = Number(new URL(String(path), 'https://lab.local').searchParams.get('offset') ?? 0)
          if (referenceFailureRef.current == 'initial' || (referenceFailureRef.current == 'next' && offset > 0)) {
            referenceFailureRef.current = 'none'
            setReferenceFailure('none')
            return Response.json({ message: 'Reference request failed' }, { status: 500 })
          }
          const references = Array.from({ length: 53 }, (_, position) => ({
            flowId: `referencing-flow-${position}`,
            name: position == 0 ? 'Workflow with a long name that wraps within the references popover' : `Referencing workflow ${position + 1}`,
            available: true,
            draft: position % 3 != 1,
            live: position % 3 == 0 ? null : { publicationId: `publication-${position}`, enabled: position % 3 != 2 },
          }))
          return Response.json({
            version: 1,
            direction: 'incoming',
            total: references.length,
            references: references.slice(offset, offset + 50),
            ...(offset + 50 < references.length ? { nextOffset: offset + 50 } : {}),
          })
        }
        if (url.endsWith('/export')) return Response.json(sampleWorkflow)
        if (url.endsWith('/error-listeners')) return Response.json({ version: 1, listeners: [] })
        if (String(path).split('?')[0] == '/v1/flows') {
          const catalog = reads++ == 0 ? flows : flows.map((item, position) => (position == 3 ? Object.assign({}, item, { name: 'Updated draft flow' }) : item))
          return Response.json({
            version: 1,
            flows: empty ? [] : catalog.map((item, position) => ({ ...item, referenceCount: position == 0 ? 53 : 0 })),
            total: empty ? 0 : catalog.length,
          })
        }
        return Response.json({ message: 'Unsupported story action' }, { status: 400 })
      },
      undefined,
      () => ({ ready: connection.promise, stop: () => connection.resolve() }),
    )
    const store = new WorkbenchStore(client, { getItem: () => null, setItem: () => {} }, undefined, i18n)
    setSession({ connect: () => connection.resolve(), i18n, store })
    void store.start()
    return () => {
      store.dispose()
      i18n.dispose()
    }
  }, [empty, language, log, single])
  if (session == null) return null
  return (
    <I18nProvider i18n={session.i18n}>
      <div className="open-flow-workbench open-flow-theme h-[520px] w-full" data-theme={dark ? 'dark' : 'light'}>
        <FlowBrowser
          ref={importRef}
          catalogWidth={embedded ? 'embedded' : undefined}
          createFlowDisabled={teamState != 'ready'}
          createFlowField={
            teamState == 'loading'
              ? {
                  state: 'loading',
                  label: 'Team',
                  description: 'The host is loading available teams.',
                  status: 'Loading teams…',
                }
              : {
                  state: 'ready',
                  ariaLabel: 'Team',
                  label: 'Team',
                  description: 'The workflow uses this team after creation.',
                  options: [{ label: 'Sample team', value: 'sample-team' }],
                  value: 'sample-team',
                  onValueChange: () => {},
                }
          }
          flowBadges={
            teams && single
              ? { flow_7a7ca0123456789abcdef67e0dd: 'crimx_team' }
              : teams
                ? Object.fromEntries(Array.from({ length: 3 }, (_, index) => [`flow-list-sample-${index}`, 'Sample team']))
                : undefined
          }
          initializing={initializing}
          language={language}
          store={session.store}
          hrefForFlow={(flow, view = 'design') => `#${flow.flowId}/${view}`}
          onCreateFlow={async () => false}
          onImportFlow={async (file, name, key) => {
            log('flow.import', { file, name, key })
            return !failImport
          }}
          onSelectFlow={(flow, view = 'design') => log('flow.open', { flowId: flow.flowId, view })}
        />
      </div>
    </I18nProvider>
  )
}

export const flowBrowserStory: FrontendStory = {
  group: 'Workbench',
  id: 'flow-browser',
  title: 'Flow list',
  description:
    'Open the reference count to compare draft, published, disabled and long-name references, and load the second page. Fail initial reference request and Fail next reference page each fail once, allowing retry without losing loaded rows. Reference links log their target flow and view. Show single workflow reproduces a short name, a full-length ID, and a team in an embedded list. Compare column spacing at wide and compact widths; search and dialog inputs keep the same text size at both widths. Hover or focus a flow name to see its full text. Hover, focus, or click a Flow ID to inspect its full value and copy action; Escape closes the tooltip. Embedded layout leaves page width and spacing to the host. Show empty list to inspect the empty state. New Flow and Import workflow include a team field for checking modal controls. Import external file and Import invalid file exercise the production ref entry. The source link sits beneath the dialog title and uses the muted theme color. Fail import submission keeps the dialog open for retry; submitted keys are logged. Team cycles ready, loading and disabled submission states. Import accepts .openflow.json files and logs the submitted content; malformed files show an error. Row menus export a deterministic sample file that can be imported again. The list loads before notifications connect. Connect notifications to refresh the Draft row without clearing the list. Show startup to inspect the skeleton. Use the row menu to rename a flow, start/stop its publication, or open publication and run history (logged with the target flow and view). Check that renaming stays centered on the flow name with compact controls; invalid names show feedback below the controls, and Enter, Escape, and Cancel retain their usual behavior. Search for Published flow to verify the menu extends beyond a single-row table. Show teams to inspect the optional Team column. Compare publication and runtime columns with equal flexible space, and check that reference counts and menus fit the action column at each width. At compact widths, team names sit below flow names, unassigned teams are hidden, and status columns stay aligned across rows. Switch language and theme to inspect labels and menus.',
  standalone: true,
  render: (log, dark, language) => <FlowBrowserStory dark={dark} language={language} log={log} />,
}
