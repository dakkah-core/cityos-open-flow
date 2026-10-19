import type { ComponentProps, ElementType, MemoExoticComponent, ReactElement, ReactNode } from 'react'
import type { AddNodeOption } from './editor/addNodeOptions.ts'
import type { NavigationStore } from './navigation.ts'
import type { WorkbenchStore } from './stores/workbenchStore.ts'

import { Children, isValidElement, useEffect } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectorAccount } from './editor/connectionSettings.tsx'
import { EditorContextPanel } from './editor/editorContextPanel.tsx'
import { FlowNodeList } from './editor/flowNodeList.tsx'
import { NodeInspector } from './editor/nodeInspector.tsx'
import { WorkbenchCanvas } from './editor/workbenchCanvas.tsx'
import FlowWorkspace, { FlowEditor } from './flowWorkspace.tsx'
import { createI18n } from './i18n.ts'
import { RevisionView } from './revisionView.ts'
import { runDrawerPreferenceKey } from './runs/runDrawerPreference.ts'
import { RunControl } from './runs/runControl.tsx'
import { WorkspaceDiagnosticsIsland } from './shell/workspaceDiagnosticsIsland.tsx'
import { WorkspacePublishIsland } from './shell/workspacePublishIsland.tsx'

const mocks = vi.hoisted(() => ({
  preferences: new Map<string, string>(),
  setOpen: vi.fn(),
  setRunDrawerOpen: vi.fn(),
  stateCall: 0,
  stateValues: new Map<number, unknown>(),
}))

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: vi.fn(),
  useCallback: (callback: unknown) => callback,
  useRef: vi.fn((initial) => ({ current: initial })),
  useState: vi.fn((initial: unknown) => {
    const call = mocks.stateCall++
    const value = mocks.stateValues.has(call) ? mocks.stateValues.get(call) : typeof initial == 'function' ? initial() : initial
    return [value, call == 0 ? mocks.setRunDrawerOpen : mocks.setOpen]
  }),
}))

vi.mock('use-value-enhancer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('use-value-enhancer')>()),
  useVal: (value: { readonly value: unknown }) => value.value,
}))

vi.mock('val-i18n-react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('val-i18n-react')>()),
  useLang: () => 'en',
  useTranslate: () => (key: string) => key,
}))

vi.mock('./editor/workbenchCanvas.tsx', () => ({ WorkbenchCanvas: () => null }))

const value = <T,>(current: T): { readonly value: T } => ({ value: current })

function isElement<T extends ElementType>(element: unknown, type: T): element is ReactElement<ComponentProps<T>, T> {
  return isValidElement(element) && element.type === type
}

function find<T extends ElementType>(
  element: ReactNode,
  type: T,
  predicate: (item: ReactElement<ComponentProps<T>, T>) => boolean = () => true,
): ReactElement<ComponentProps<T>, T> | undefined {
  if (!isValidElement<{ readonly children?: ReactNode }>(element)) return
  const children = element.props.children
  if (isElement(element, type) && predicate(element)) return element
  for (const child of Children.toArray(children)) {
    const match = find(child, type, predicate)
    if (match != null) return match
  }
}

type InspectorContainerProps = Pick<ComponentProps<typeof NodeInspector>, 'focus' | 'disabled' | 'revision' | 'selection' | 'theme'> & {
  readonly store: WorkbenchStore
}

function isInspectorContainer(
  element: ReactNode,
): element is ReactElement<InspectorContainerProps, MemoExoticComponent<(props: InspectorContainerProps) => ReactElement>> {
  const type: unknown = isValidElement(element) ? element.type : undefined
  return (
    typeof type == 'object' &&
    type != null &&
    'type' in type &&
    typeof type.type == 'function' &&
    type.type.name == 'NodeInspectorContainer'
  )
}

function renderWorkspace(busy?: string, withTrigger = true, invalid = false, selectedNodeIds: readonly string[] = [], hasUnpublishedChanges = true) {
  const navigation = {
    $: { view: value('design') },
    open: vi.fn(),
    openFlows: vi.fn(),
    openMainFlow: vi.fn(),
  } as unknown as NavigationStore
  const store = {
    preferences: { getItem: (key: string) => mocks.preferences.get(key) ?? null, setItem: (key: string, stored: string) => mocks.preferences.set(key, stored) },
    $: {
      busy: value(busy),
      variableNames: value([]),
      variableNamesLoaded: value(false),
      variableNamesLoading: value(false),
      diagnostics: value(invalid ? { valid: false, diagnostics: [{ code: 'trigger.connection-missing' }] } : undefined),
      diagnosticItems: value(
        invalid
          ? [
              {
                diagnostic: {
                  code: 'trigger.connection-missing',
                  column: 0,
                  line: 1,
                  message: 'Missing account',
                  path: '/document/graph/nodes/start/bindingId',
                },
                location: { nodeId: 'start', section: 'account' },
                scope: 'node',
              },
            ]
          : [],
      ),
      designer: value({
        nodes: withTrigger ? [{ id: 'start', kind: 'trigger', title: 'Start', presentation: { kind: 'start', schedules: [] } }] : [],
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
      designerNodeById: value(new Map([['start', { kind: 'trigger', title: 'Start' }]])),
      selectedDesignerNode: value(undefined),
    },
    connectors: {
      $: {
        pickerConnections: value([]),
        actionLoading: value(undefined),
        connectionLoading: value(undefined),
        selectedAction: value(undefined),
        selectedActionError: value(undefined),
        selectedActiveConnections: value([]),
        selectedAuthorizationPending: value(false),
        selectedConnection: value(undefined),
        selectedConnectionError: value(undefined),
      },
    },
    connectorAccess: { $: value({}) },
    addNode: vi.fn().mockResolvedValue('new-node'),
    selectNodes: vi.fn(),
    editDraftRunInputs: vi.fn().mockResolvedValue('input'),
    requestDraftRun: vi.fn().mockResolvedValue('started'),
    requestLiveRun: vi.fn().mockResolvedValue('started'),
    runRequests: {
      $: { submitting: value(undefined), inputRequest: value(undefined) },
      dismissInputs: vi.fn(),
      inputStatus: vi.fn(() => 'none'),
    },
    publications: {
      $: { bindings: value({ status: 'idle', bindings: [] }) },
      loadBindings: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn().mockResolvedValue(true),
    },
    runs: { $: { externalRunId: value(undefined) } },
    triggers: {
      catalog: { state: value({ data: undefined, refreshing: false, error: undefined }), open: vi.fn() },
      $: {
        connectionLoading: value(undefined),
        selectedActiveConnections: value([]),
        selectedAuthorizationPending: value(false),
        selectedConnection: value(undefined),
        selectedConnectionError: value(undefined),
      },
    },
    workspace: {
      history$: value({ canUndo: false, canRedo: false, applying: false, failed: false }),
      $: {
        addNodeOptions: value([]),
        checkLoading: value(false),
        diagnosticFocus: value(undefined),
        draft: value({
          flowId: 'flow',
          revisionId: 'revision',
          content: { document: { bindings: {}, graph: { edges: [], nodes: withTrigger ? { start: { kind: 'start', name: 'Start' } } : {} } } },
        }),
        moduleEditor: value(undefined),
        flow: value({ flowId: 'flow', name: 'Example flow' }),
        flowId: value('flow'),
        live: value({ hasUnpublishedChanges }),
        inspectorDiagnostics: value([]),
        nodeFocus: value(undefined),
        revision: value({}),
        selectedNodeIds: value(selectedNodeIds),
        selection: value(undefined),
        status: value('saved'),
        targetName: value('Flow'),
        workspaceLoadFailed: value(false),
        workspaceLoadProblem: value(undefined),
        workspaceLoading: value(false),
        workspaceRepairing: value(false),
      },
      locateNode: vi.fn(),
      locateDiagnostic: vi.fn(),
      check: vi.fn(),
      repairWorkspace: vi.fn(),
    },
  } as unknown as WorkbenchStore
  const element = FlowWorkspace({
    hrefFor: () => '/',
    navigation,
    store,
    theme: 'light',
  })
  const editor = find(element, FlowEditor)!
  return { editor, navigation, store }
}

describe('FlowWorkspace run drawer', () => {
  beforeEach(() => {
    mocks.preferences.clear()
    mocks.setOpen.mockReset()
    mocks.setRunDrawerOpen.mockReset()
    mocks.stateCall = 0
    mocks.stateValues.clear()
    vi.mocked(useEffect).mockReset()
  })

  it('keeps Run inputs open across Draft saves and dismisses them when switching workflows', () => {
    const previous: (readonly unknown[] | undefined)[] = []
    let index = 0
    let pending: (() => unknown)[] = []
    vi.mocked(useEffect).mockImplementation((effect, dependencies) => {
      const slot = index++
      const old = previous[slot]
      if (old == null || dependencies == null || old.length != dependencies.length || dependencies.some((entry, i) => entry !== old[i])) pending.push(effect)
      previous[slot] = dependencies
    })
    const flush = () => {
      for (const effect of pending) effect()
      pending = []
      index = 0
      mocks.stateCall = 0
    }
    const { navigation, store } = renderWorkspace()
    flush()
    vi.mocked(store.runRequests.dismissInputs).mockClear()
    const render = () => {
      FlowWorkspace({ hrefFor: () => '/', navigation, store, theme: 'light' })
      flush()
    }
    Object.assign(store.workspace.$.draft, { value: { ...store.workspace.$.draft.value, revisionId: 'saved-revision' } })
    render()
    expect(store.runRequests.dismissInputs).not.toHaveBeenCalled()
    Object.assign(store.workspace.$.flowId, { value: 'another-flow' })
    render()
    expect(store.runRequests.dismissInputs).toHaveBeenCalledOnce()
  })

  it('passes the current Draft and unsaved code state into the production canvas boundary', () => {
    const { editor, store } = renderWorkspace()
    const context = () => {
      const tree = FlowEditor(editor.props)
      const canvas = find(tree, WorkbenchCanvas)
      expect(canvas).toBeDefined()
      return canvas!.props.annotationContext
    }
    expect(context()).toMatchObject({ flowId: 'flow', revisionId: 'revision', syncState: 'saved' })
    Object.assign(store.workspace.$.moduleEditor, { value: { status: 'dirty' } })
    expect(context()).toMatchObject({ flowId: 'flow', revisionId: 'revision', syncState: 'dirty' })
    Object.assign(store.workspace.$.draft, { value: { ...store.workspace.$.draft.value, revisionId: 'next-revision' } })
    Object.assign(store.workspace.$.moduleEditor, { value: undefined })
    expect(context()).toMatchObject({ flowId: 'flow', revisionId: 'next-revision', syncState: 'saved' })
    Object.assign(store.workspace.$.flowId, { value: 'other-flow' })
    expect(context()).toBeUndefined()
  })

  it('keeps the expired account name and recovery message after assignable accounts finish loading', () => {
    mocks.stateValues.set(3, true)
    mocks.stateValues.set(4, 'properties')
    const { editor, store } = renderWorkspace(undefined, true, false, ['mail'])
    const definition = {
      executor: { action: 'gmail.fetch_emails', connectionId: 'expired', kind: 'connector' },
      inputs: [],
      outputs: [],
      name: 'Read mail',
    } as const
    const node = { inputs: {}, kind: 'task', task: definition } as const
    const revision = new RevisionView({
      content: { document: { bindings: {}, graph: { nodes: { mail: node }, edges: [] } }, modules: {} },
    } as never)
    Object.assign(store.$, { connectorSetupPending: value(false), sourceNodeIcons: value({}) })
    Object.assign(store.workspace.$.revision, { value: revision })
    Object.assign(store.workspace.$.selection, { value: { id: 'mail', kind: 'task', node, definition } })
    Object.assign(store.connectors.$.selectedAction, {
      value: { actionId: 'gmail.fetch_emails', authenticated: true, serviceId: 'gmail', serviceName: 'Gmail' },
    })
    Object.assign(store.connectors.$.selectedConnection, {
      value: { connectionId: 'expired', displayName: 'Saved Gmail account', serviceId: 'gmail', isDefault: false, status: 'reauth_required' },
    })
    const view = FlowEditor(editor.props)
    const container = Children.toArray(find(view, EditorContextPanel)!.props.children).find(isInspectorContainer)!
    if (container.props.selection?.id != 'mail') throw new Error('Expected selected mail inspector.')
    const renderInspector = container.type.type
    for (const candidates of [undefined, [], [{ connectionId: 'other', permissions: { allActions: true } }]]) {
      Object.assign(store.connectorAccess.$, {
        value: { access: { mode: 'selectable', bindings: [] }, candidates: { gmail: candidates == null ? undefined : { candidates } } },
      })
      const inspector = renderInspector(container.props)
      const account = find(NodeInspector(find(inspector, NodeInspector)!.props), ConnectorAccount)!
      const markup = renderToStaticMarkup(<I18nProvider i18n={createI18n()}>{account}</I18nProvider>)
      expect(markup).toContain('Saved Gmail account')
      expect(markup).toContain('inspector.account.status.reauth_required')
      expect(markup).not.toContain('inspector.account.missing')
      expect(markup).not.toContain('connectorAccess.noAvailablePermissions')
    }
  })

  it.each([false, true])('runs from the canvas and opens logs despite unrelated diagnostics (invalid: %s)', async (invalid) => {
    const { editor, store } = renderWorkspace(undefined, true, invalid)
    const view = FlowEditor(editor.props)
    const designer = find(view, WorkbenchCanvas)!
    expect(find(designer.props.runControl, RunControl)!.props.disabled).toBe(false)
    find(designer.props.runControl, RunControl)!.props.onRun()
    await Promise.resolve()
    expect(store.requestDraftRun).toHaveBeenCalledWith('start')
    expect(mocks.setRunDrawerOpen).toHaveBeenCalledWith(true)
  })

  it.each([false, true])('preserves drawer visibility while a run is submitting (open: %s)', (open) => {
    const { navigation, store } = renderWorkspace()
    Object.assign(store.runRequests.$.submitting, { value: 'draft' })
    mocks.stateCall = 0
    mocks.stateValues.set(0, open)
    mocks.setRunDrawerOpen.mockClear()
    vi.mocked(useEffect).mockClear()

    FlowWorkspace({ hrefFor: () => '/', navigation, store, theme: 'light' })
    for (const [effect] of vi.mocked(useEffect).mock.calls) effect()

    expect(navigation.open).toHaveBeenCalledWith('design')
    expect(mocks.setRunDrawerOpen).not.toHaveBeenCalled()
  })

  it.each([false, true])('restores the shared explicit drawer preference %s without auto-opening', (open) => {
    mocks.preferences.set(runDrawerPreferenceKey, String(open))
    const { editor } = renderWorkspace()
    expect(editor.props.runDrawerOpen).toBe(open)
    editor.props.onRunStarted()
    expect(mocks.setRunDrawerOpen).not.toHaveBeenCalled()
  })

  it('persists manual closing across workspace mounts and suppresses an in-flight run reveal', () => {
    const { editor } = renderWorkspace()
    editor.props.onCloseRuns()
    expect(mocks.preferences.get(runDrawerPreferenceKey)).toBe('false')
    mocks.setRunDrawerOpen.mockClear()
    editor.props.onRunStarted()
    expect(mocks.setRunDrawerOpen).not.toHaveBeenCalled()
    mocks.stateCall = 0
    expect(renderWorkspace().editor.props.runDrawerOpen).toBe(false)
  })

  it('persists manual opening across workspace mounts', () => {
    const { editor } = renderWorkspace()
    editor.props.onToggleRuns()
    expect(mocks.preferences.get(runDrawerPreferenceKey)).toBe('true')
    mocks.stateCall = 0
    expect(renderWorkspace().editor.props.runDrawerOpen).toBe(true)
  })

  it.each([undefined, false, true])('handles external runs with preference %s', (preference) => {
    if (preference != null) mocks.preferences.set(runDrawerPreferenceKey, String(preference))
    const { navigation, store } = renderWorkspace()
    Object.assign(store.runs.$.externalRunId, { value: 'external-run' })
    mocks.stateCall = 0
    vi.mocked(useEffect).mockClear()
    FlowWorkspace({ hrefFor: () => '/', navigation, store, theme: 'light' })
    for (const [effect] of vi.mocked(useEffect).mock.calls) effect()
    if (preference == null) expect(mocks.setRunDrawerOpen).toHaveBeenCalledWith(true)
    else expect(mocks.setRunDrawerOpen).not.toHaveBeenCalled()
  })

  it('does not persist automatic opening', () => {
    const { editor } = renderWorkspace()
    editor.props.onRunStarted()
    expect(mocks.setRunDrawerOpen).toHaveBeenCalledWith(true)
    expect(mocks.preferences.has(runDrawerPreferenceKey)).toBe(false)
  })

  it('keeps the test button enabled while ordinary edits save', () => {
    const { editor } = renderWorkspace('designer')
    const view = FlowEditor(editor.props)
    const designer = find(view, WorkbenchCanvas)!
    expect(find(designer.props.runControl, RunControl)!.props.disabled).toBe(false)
    expect(find(designer.props.runControl, RunControl)!.props.starting).toBe(false)
  })

  it.each(['new-node', undefined])('preserves inspector state when adding a node: %s', async (nodeId) => {
    const { editor, store } = renderWorkspace()
    vi.mocked(store.addNode).mockResolvedValue(nodeId)
    const view = FlowEditor(editor.props)
    const designer = find(view, WorkbenchCanvas)!
    mocks.setOpen.mockClear()
    const option: AddNodeOption = { kind: 'new-task', id: 'new-task', label: 'Code', description: '', inputs: [], outputs: [] }
    const position = { x: 92, y: 92 }

    expect(await designer.props.onAddNode(option, position)).toBe(nodeId)
    expect(store.addNode).toHaveBeenCalledWith(option, position, undefined)
    expect(mocks.setOpen).not.toHaveBeenCalled()
  })

  it('switches an open inspector to the added node properties', async () => {
    mocks.stateValues.set(3, true)
    mocks.stateValues.set(4, 'outline')
    const { editor, store } = renderWorkspace()
    const view = FlowEditor(editor.props)
    const designer = find(view, WorkbenchCanvas)!
    const option: AddNodeOption = { kind: 'new-task', id: 'new-task', label: 'Code', description: '', inputs: [], outputs: [] }
    const position = { x: 92, y: 92 }

    mocks.setOpen.mockClear()
    expect(await designer.props.onAddNode(option, position)).toBe('new-node')

    expect(store.selectNodes).toHaveBeenCalledWith(['new-node'])
    expect(mocks.setOpen).toHaveBeenCalledWith('properties')
  })

  it('hides execution when the graph has no trigger', () => {
    const { editor } = renderWorkspace(undefined, false)
    const view = FlowEditor(editor.props)
    const designer = find(view, WorkbenchCanvas)!
    expect(designer.props.runControl).toBeUndefined()
  })

  it('selects Start before an earlier event trigger', () => {
    const { editor, store } = renderWorkspace()
    Object.assign(store.$.designer, {
      value: {
        nodes: [
          { id: 'timer', kind: 'trigger', title: 'Schedule', presentation: { kind: 'cron', schedules: [] } },
          { id: 'start', kind: 'trigger', title: 'Start', presentation: { kind: 'start', schedules: [] } },
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    })
    const view = FlowEditor(editor.props)
    const designer = find(view, WorkbenchCanvas)!
    expect(find(designer.props.runControl, RunControl)!.props.selectedTriggerId).toBe('start')
    find(designer.props.runControl, RunControl)!.props.onRun()
    expect(store.requestDraftRun).toHaveBeenCalledWith('start')
  })

  it('switches the test trigger without navigating or starting a run', () => {
    const { editor, navigation, store } = renderWorkspace()
    const view = FlowEditor(editor.props)
    const designer = find(view, WorkbenchCanvas)!

    find(designer.props.runControl, RunControl)!.props.onSelectTrigger('another-trigger')

    expect(store.runRequests.dismissInputs).toHaveBeenCalledOnce()
    expect(store.requestDraftRun).not.toHaveBeenCalled()
    expect(navigation.open).not.toHaveBeenCalled()
  })

  it('keeps the Designer editable while preparing a run', () => {
    const { editor } = renderWorkspace('run')
    const view = FlowEditor(editor.props)
    const designer = find(view, WorkbenchCanvas)!

    expect(designer.props.disabled).toBe(false)
  })

  it('publishes from the corner island and opens publication or run history from its menu', () => {
    const { editor, navigation, store } = renderWorkspace()
    const view = FlowEditor(editor.props)
    const designer = find(view, WorkbenchCanvas)!
    const publishIsland = find(designer.props.cornerLeading, WorkspacePublishIsland)!

    expect(publishIsland.props.state).toBe('ready')
    publishIsland.props.onPublish()
    expect(store.publications.publish).toHaveBeenCalledOnce()

    publishIsland.props.onOpenPublications()
    expect(store.runRequests.dismissInputs).toHaveBeenCalledOnce()
    expect(navigation.open).toHaveBeenCalledWith('publications')

    publishIsland.props.onOpenRuns()
    expect(store.runRequests.dismissInputs).toHaveBeenCalledTimes(2)
    expect(navigation.open).toHaveBeenCalledWith('runs')
  })

  it('keeps publication history available when publishing is blocked', () => {
    const { editor, navigation } = renderWorkspace(undefined, true, true)
    const view = FlowEditor(editor.props)
    const designer = find(view, WorkbenchCanvas)!
    const publishIsland = find(designer.props.cornerLeading, WorkspacePublishIsland)!

    expect(publishIsland.props.state).toBe('issues')
    publishIsland.props.onOpenPublications()
    expect(navigation.open).toHaveBeenCalledWith('publications')
  })

  it.each([false, true])('opens node properties when locating an issue with the sidebar open: %s', (open) => {
    mocks.stateValues.set(3, open)
    mocks.stateValues.set(4, 'outline')
    const { editor, store } = renderWorkspace(undefined, true, true)
    vi.mocked(store.workspace.locateNode).mockReturnValue(true)
    const view = FlowEditor(editor.props)
    const designer = find(view, WorkbenchCanvas)!
    const issues = find(designer.props.cornerLeading, WorkspaceDiagnosticsIsland)!
    const publish = find(designer.props.cornerLeading, WorkspacePublishIsland)!

    expect(issues.props.items).toHaveLength(1)
    expect(publish.props.state).toBe('issues')
    issues.props.onSelectNode('start')
    expect(store.workspace.locateNode).toHaveBeenCalledWith('start')
    expect(mocks.setOpen).toHaveBeenCalledWith(true)
    expect(mocks.setOpen).toHaveBeenCalledWith('properties')
    expect(mocks.setOpen).toHaveBeenCalledWith(false)
  })

  it('keeps the sidebar and issues unchanged when the diagnostic node cannot be located', () => {
    const { editor, store } = renderWorkspace(undefined, true, true)
    vi.mocked(store.workspace.locateNode).mockReturnValue(false)
    const view = FlowEditor(editor.props)
    const designer = find(view, WorkbenchCanvas)!
    const issues = find(designer.props.cornerLeading, WorkspaceDiagnosticsIsland)!
    mocks.setOpen.mockClear()

    issues.props.onSelectNode('missing')

    expect(store.workspace.locateNode).toHaveBeenCalledWith('missing')
    expect(mocks.setOpen).not.toHaveBeenCalled()
  })

  it.each([
    ['publish', 'publishing'],
    ['run', 'busy'],
  ])('identifies why publishing is unavailable during %s', (busy, state) => {
    const { editor } = renderWorkspace(busy)
    const view = FlowEditor(editor.props)
    const designer = find(view, WorkbenchCanvas)!

    expect(find(designer.props.cornerLeading, WorkspacePublishIsland)!.props.state).toBe(state)
  })

  it('marks an unchanged draft as current', () => {
    const { editor } = renderWorkspace(undefined, true, false, [], false)
    const view = FlowEditor(editor.props)
    const designer = find(view, WorkbenchCanvas)!

    expect(find(designer.props.cornerLeading, WorkspacePublishIsland)!.props.state).toBe('current')
  })

  it.each([
    { page: 'outline', selectedNodeIds: [] },
    { page: 'properties', selectedNodeIds: ['start', 'task'] },
  ])('focuses a node selected from the $page node list', ({ page, selectedNodeIds }) => {
    mocks.stateValues.set(3, true)
    mocks.stateValues.set(4, page)
    const { editor, store } = renderWorkspace(undefined, true, false, selectedNodeIds)
    const view = FlowEditor(editor.props)
    const contextPanel = find(view, EditorContextPanel)!
    const panelChildren = Children.toArray(contextPanel.props.children)
    const nodeList = find(page == 'outline' ? panelChildren[0] : panelChildren[1], FlowNodeList)!

    nodeList.props.onSelect('start')

    expect(store.selectNodes).toHaveBeenCalledWith(['start'])
    expect(store.workspace.locateNode).toHaveBeenCalledWith('start', { preserveSelection: true })
  })

  it.each([
    { page: 'outline', selectedNodeIds: [] },
    { page: 'properties', selectedNodeIds: ['start', 'task'] },
  ])('keeps the $page node list open when locating a node', ({ page, selectedNodeIds }) => {
    mocks.stateValues.set(3, true)
    mocks.stateValues.set(4, page)
    const { editor, store } = renderWorkspace(undefined, true, false, selectedNodeIds)
    const view = FlowEditor(editor.props)
    const contextPanel = find(view, EditorContextPanel)!
    const panelChildren = Children.toArray(contextPanel.props.children)
    const nodeList = find(page == 'outline' ? panelChildren[0] : panelChildren[1], FlowNodeList)!

    nodeList.props.onFocusNode('start')

    expect(store.selectNodes).not.toHaveBeenCalled()
    expect(store.workspace.locateNode).toHaveBeenCalledWith('start', { preserveSelection: true })
  })
})
