import type { ComponentProps, ElementType, ReactElement, ReactNode } from 'react'

import { Children, isValidElement } from 'react'
import { val } from 'value-enhancer'
import { describe, expect, it, vi } from 'vitest'
import { nodeInputMappings } from '../../../../flow/common/condition.ts'
import { ValueEditorFeedback } from '../../../../form/browser/fieldControl.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { Select, SelectItem } from '../../../../ui/browser/select.tsx'
import { Switch } from '../../../../ui/browser/switch.tsx'
import { Textarea } from '../../../../ui/browser/textarea.tsx'
import { TooltipTrigger } from '../../../../ui/browser/tooltip.tsx'
import { ActionSelectionDialog } from './actionSelectionDialog.tsx'
import { CodeEditor } from './codeEditor.tsx'
import { CodeTaskSection } from './codeTaskSection.tsx'
import { AccountSelect, ConnectorAccount, TriggerConnection } from './connectionSettings.tsx'
import { FeishuTriggerConfig } from './feishuTriggerConfig.tsx'
import { GeneralSettings } from './generalSettings.tsx'
import { LlmTaskSection } from './llmTaskSection.tsx'
import { NodeInputs } from './nodeInputs.tsx'
import { NodeInspector } from './nodeInspector.tsx'
import { OpenApiSection } from './openApiSection.tsx'
import { ResolutionDefinition } from './resolutionDefinition.tsx'
import { TriggerSummary } from './triggerSummary.tsx'
import { WebhookEditor } from './webhookEditor.tsx'

vi.mock('use-value-enhancer', () => ({ useVal: (value: { value: unknown }) => value.value }))

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: vi.fn(),
  useMemo: (create: () => unknown) => create(),
  useRef: (value: unknown) => ({ current: value }),
  useState: vi.fn((initial: unknown) => [typeof initial == 'function' ? initial() : initial, vi.fn()]),
}))

vi.mock('val-i18n-react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('val-i18n-react')>()),
  useLang: () => 'en',
  useTranslate: () => (key: string) => key,
}))

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

function renderCodeSection(props: Parameters<typeof CodeTaskSection>[0]): ReactElement {
  let element = CodeTaskSection(props)
  while (element != null && typeof element.type === 'function' && ['EditableCodeTaskSection', 'CodeTaskFrame'].includes(element.type.name)) {
    element = (element.type as (props: unknown) => ReactElement)(element.props)
  }
  if (element == null) throw new Error('Expected Code section.')
  return element
}

function resolutionDefinition(
  node: { readonly kind: 'approval' | 'wait' } & Readonly<Record<string, unknown>>,
  revision: unknown,
  saveResolution: ReturnType<typeof vi.fn>,
): ReactElement {
  const view = { inputMappings: nodeInputMappings, graph: () => ({ nodes: { wait: node } }), ...(revision as object) }
  const element = NodeInspector({
    variables: { enabled: true, names: [], loaded: false, loading: false, onOpen: vi.fn() },
    activeConnectorConnections: [],
    connectorAuthorizationPending: false,
    connectorLoading: false,
    connectors: {} as never,
    disabled: false,
    revision: view as never,
    selection: { id: 'wait', kind: node.kind, node } as never,
    store: { $: { flowId: { value: 'flow' } }, saveResolution } as never,
    theme: 'light',
    triggerAuthorizationPending: false,
    triggerConnectionLoading: false,
    triggers: {} as never,
  })
  const resolution = find(element, ResolutionDefinition)
  if (resolution == null || typeof resolution.type != 'function') throw new Error('Expected resolution settings.')
  return ResolutionDefinition(resolution.props)
}

describe('Provider account section', () => {
  it.each(['empty', 'invalid'] as const)('routes %s account authorization to the supplied account management entry', (state) => {
    const configure = vi.fn()
    const connect = vi.fn()
    const rendered = ConnectorAccount({
      action: { authenticated: true, serviceId: 'slack', serviceName: 'Slack' } as never,
      actionError: undefined,
      actionId: 'slack.send-message',
      accessError: state == 'invalid' ? 'Access required' : undefined,
      activeConnections: [],
      authorizationPending: false,
      connection: undefined,
      connectionError: undefined,
      connectionId: undefined,
      connectors: { connect } as never,
      disabled: false,
      fieldIdPrefix: 'slack',
      loading: false,
      nodeId: 'task',
      onConfigureAccess: configure,
    })
    const button = find(rendered, Button, (item) => typeof item.props.onClick == 'function')
    ;(button!.props.onClick as () => void)()
    expect(configure).toHaveBeenCalledOnce()
    expect(connect).not.toHaveBeenCalled()
  })

  it('routes trigger account authorization to its provider account management entry', () => {
    const configure = vi.fn()
    const connect = vi.fn()
    const rendered = TriggerConnection({
      activeConnections: [],
      authorizationPending: false,
      connectionLoading: false,
      disabled: false,
      selection: { id: 'trigger', trigger: { kind: 'integration', definition: { provider: 'slack' } } } as never,
      triggers: { connect } as never,
      onConfigureAccess: configure,
    })!
    const button = find(rendered, Button, (item) => typeof item.props.onClick == 'function')
    ;(button!.props.onClick as () => void)()
    expect(configure).toHaveBeenCalledWith('slack')
    expect(connect).not.toHaveBeenCalled()
  })

  it('offers account management without passive active-connection copy', () => {
    const connect = vi.fn()
    const configureAccess = vi.fn()
    const setConnection = vi.fn()
    const definition = {
      executor: { action: 'slack.send-message', connectionId: 'connection', kind: 'connector' },
      inputs: [],
      name: 'Send message',
      outputs: [],
    }
    const node = { inputs: {}, kind: 'task', name: 'Send message', task: definition }
    const element = NodeInspector({
      variables: { enabled: true, names: [], loaded: true, loading: false, onOpen: vi.fn() },
      activeConnectorConnections: [{ connectionId: 'connection', displayName: 'Work', isDefault: true, serviceId: 'slack', status: 'active' }],
      connectorAction: { authenticated: true, serviceId: 'slack', serviceName: 'Slack' } as never,
      connectorAuthorizationPending: false,
      connectorConnection: { connectionId: 'connection', displayName: 'Work', isDefault: true, serviceId: 'slack', status: 'active' },
      connectorLoading: false,
      connectors: { connect, setConnection } as never,
      onConfigureConnectorAccess: configureAccess,
      disabled: false,
      revision: { inputMappings: nodeInputMappings, graph: () => ({ nodes: { provider: node } }) } as never,
      selection: { definition, id: 'provider', kind: 'task', node } as never,
      store: { $: { flowId: { value: 'flow' }, moduleEditor: { value: undefined } } } as never,
      theme: 'light',
      triggerAuthorizationPending: false,
      triggerConnectionLoading: false,
      triggers: {} as never,
    })
    const account = find(element, ConnectorAccount)
    if (account == null || typeof account.type != 'function') throw new Error('Expected Provider account section.')
    const rendered = ConnectorAccount(account.props)
    const manage = find(rendered, Button, (item) => item.props.children == 'inspector.account.manageAccount')
    const accountSelect = find(rendered, AccountSelect)
    if (accountSelect == null || typeof accountSelect.type != 'function') throw new Error('Expected account selector.')
    const renderedSelect = AccountSelect(accountSelect.props)
    const addAccount = find(renderedSelect, SelectItem, (item) => item.props.children == 'inspector.account.addAccount')
    const select = find(renderedSelect, Select, (item) => typeof item.props.onValueChange == 'function')

    expect(manage?.props.children).toBe('inspector.account.manageAccount')
    expect(addAccount?.props.children).toBe('inspector.account.addAccount')
    expect(find(rendered, 'p', (item) => item.props.children == 'inspector.account.pinned')).toBeUndefined()

    ;(manage!.props.onClick as () => void)()
    ;(select!.props.onValueChange as (value: string) => void)(addAccount!.props.value as string)

    expect(configureAccess).not.toHaveBeenCalled()
    expect(connect).toHaveBeenLastCalledWith('slack')
    expect(connect).toHaveBeenCalledTimes(2)
    expect(setConnection).not.toHaveBeenCalled()
    ;(select!.props.onValueChange as (value: string) => void)('connection')
    expect(setConnection).toHaveBeenCalledWith('provider', 'connection')
  })
})

describe('Provider Trigger sections', () => {
  it('shows the standard account section for Feishu App Bot triggers', () => {
    const trigger = {
      config: {},
      definition: {
        configInputs: [{ handle: 'sourceId', jsonSchema: { type: 'string' }, nullable: false }],
        description: 'Receives Feishu events.',
        endpoint: { body: { allowArray: false, allowEmpty: false, formats: ['json'] }, methods: ['POST'], successStatus: 200 },
        key: 'feishu_app_bot.on_event',
        name: 'on_event',
        provider: 'feishu_app_bot',
        type: 'integration',
      },
      inputs: {},
      kind: 'integration',
      name: 'Application Event',
      connectionId: 'feishu-account',
    }
    const element = NodeInspector({
      variables: { enabled: false, names: [], loaded: true, loading: false, onOpen: vi.fn() },
      connectorAuthorizationPending: false,
      connectorLoading: false,
      connectors: {} as never,
      disabled: false,
      revision: { inputMappings: nodeInputMappings, inputDefs: () => [] } as never,
      selection: { id: 'feishu-trigger', kind: 'trigger', node: trigger, trigger } as never,
      store: { $: { flowId: { value: 'flow' } } } as never,
      theme: 'light',
      triggerActiveConnections: [],
      triggerAuthorizationPending: false,
      triggerConnectionLoading: false,
      triggers: {} as never,
    })

    const connection = find(element, TriggerConnection)
    const config = find(element, FeishuTriggerConfig)

    expect(connection).toBeDefined()
    expect(config?.props.connectionId).toBe('feishu-account')
  })

  it('orders Provider options before Outputs and Node settings', () => {
    const trigger = {
      config: {},
      definition: {
        configInputs: [{ handle: 'query', jsonSchema: { type: 'string' }, nullable: true }],
        description: 'Polls a mailbox.',
        key: 'gmail.on_message_received',
        name: 'on_message_received',
        provider: 'gmail',
        type: 'poll',
      },
      inputs: {},
      kind: 'poll',
      name: 'New message received',
      pollTimes: [{ type: 'every', unit: 'minute', value: 5 }],
    }
    const element = NodeInspector({
      variables: { enabled: false, names: [], loaded: true, loading: false, onOpen: vi.fn() },
      connectorAuthorizationPending: false,
      connectorLoading: false,
      connectors: {} as never,
      disabled: false,
      revision: { inputMappings: nodeInputMappings, inputDefs: () => [] } as never,
      selection: { id: 'provider-trigger', kind: 'trigger', node: trigger, trigger } as never,
      store: { $: { flowId: { value: 'flow' } }, saveTriggerConfig: vi.fn(), saveTriggerSchedule: vi.fn() } as never,
      theme: 'light',
      triggerActiveConnections: [],
      triggerAuthorizationPending: false,
      triggerConnectionLoading: false,
      triggers: {} as never,
    })
    const content = find(element, 'div', (item) => item.props.className == 'inspector-content')
    if (content == null) throw new Error('Expected inspector content.')
    const sections = Children.toArray(content.props.children)
      .filter(isValidElement)
      .map((item) => (typeof item.type == 'function' ? item.type.name : item.type))

    expect(sections.indexOf('TriggerConfigEditor')).toBeLessThan(sections.indexOf('TriggerSummary'))
    expect(sections.indexOf('TriggerSummary')).toBeLessThan(sections.indexOf('TriggerScheduleEditor'))
  })
})

describe('Webhook Trigger sections', () => {
  it('provides Outputs to the Webhook editor for owned section ordering', () => {
    const trigger = { bodyFields: [], kind: 'webhook', method: 'POST', name: 'Webhook', options: {} }
    const element = NodeInspector({
      variables: { enabled: false, names: [], loaded: true, loading: false, onOpen: vi.fn() },
      connectorAuthorizationPending: false,
      connectorLoading: false,
      connectors: {} as never,
      disabled: false,
      revision: { inputMappings: nodeInputMappings, inputDefs: () => [] } as never,
      selection: { id: 'webhook-trigger', kind: 'trigger', node: trigger, trigger } as never,
      store: { $: { flowId: { value: 'flow' } }, saveWebhook: vi.fn() } as never,
      theme: 'light',
      triggerAuthorizationPending: false,
      triggerConnectionLoading: false,
      triggers: {} as never,
    })
    const editor = find(element, WebhookEditor)
    expect(isValidElement(editor?.props.outputSection)).toBe(true)
    const outputSection = editor?.props.outputSection
    expect(isElement(outputSection, TriggerSummary) ? outputSection.type.name : undefined).toBe('TriggerSummary')
  })
})

describe('Resolution Inspector', () => {
  it.each(['approval', 'wait'] as const)('saves the latest %s prompt on blur and preserves the node name', (kind) => {
    const saveResolution = vi.fn().mockResolvedValue(true)
    const definition = resolutionDefinition(
      { inputDefinitions: [{ handle: 'value', jsonSchema: {}, nullable: true }], inputs: {}, kind, name: 'Renamed', prompt: 'Continue?' },
      {},
      saveResolution,
    )
    const input = find(definition, Textarea, (item) => item.props.id == 'wait-wait-prompt')
    if (input == null) throw new Error('Expected prompt.')
    const blur = (input.props as { readonly onBlur: (event: { currentTarget: { value: string } }) => void }).onBlur
    blur({ currentTarget: { value: 'Continue?' } })
    expect(saveResolution).not.toHaveBeenCalled()
    blur({ currentTarget: { value: '  Review this request  ' } })
    expect(saveResolution).toHaveBeenCalledWith('wait', {
      name: 'Renamed',
      prompt: 'Review this request',
    })
    saveResolution.mockClear()
    blur({ currentTarget: { value: '  ' } })
    expect(saveResolution).not.toHaveBeenCalled()
  })
})

describe('Node execution settings', () => {
  it('saves execution limits and timeout, preserves sibling settings, and rejects invalid values', () => {
    const saveNodeSettings = vi.fn()
    const node = {
      inputs: {},
      kind: 'task',
      name: 'Review',
      task: { name: 'Review', inputs: [], outputs: [], executor: { kind: 'llm', mode: 'chat' } },
      timeoutMs: 100,
      maxExecutions: 25,
    }
    const revision = {
      inputMappings: nodeInputMappings,
      graph: () => ({ nodes: { current: node, other: { inputs: {}, kind: 'value', name: 'Review', values: [] } } }),
    }
    const element = NodeInspector({
      variables: { enabled: true, names: [], loaded: false, loading: false, onOpen: vi.fn() },
      activeConnectorConnections: [],
      connectorAuthorizationPending: false,
      connectorLoading: false,
      connectors: {} as never,
      disabled: false,
      revision: revision as never,
      selection: { id: 'current', kind: 'task', node, definition: { inputs: [], outputs: [], executor: { kind: 'llm', mode: 'chat' } } } as never,
      store: { $: { flowId: { value: 'flow' } }, saveNodeSettings } as never,
      theme: 'light',
      triggerAuthorizationPending: false,
      triggerConnectionLoading: false,
      triggers: {} as never,
    })
    const settings = find(element, GeneralSettings)
    if (settings == null || typeof settings.type != 'function') throw new Error('Expected general settings.')
    const rendered = GeneralSettings(settings.props)
    expect(rendered.type).toBe('details')
    if (!isElement(rendered, 'details')) throw new Error('Expected general settings details.')
    expect(rendered.props.open).toBeUndefined()
    const input = find(rendered, Input, (item) => item.props.id == 'node-current-timeout')
    if (input == null) throw new Error('Expected timeout input.')
    const blur = (input.props as { readonly onBlur: (event: { currentTarget: { value: string } }) => void }).onBlur
    for (const value of ['100', '0', '-1', '1.5', 'Infinity']) blur({ currentTarget: { value } })
    expect(saveNodeSettings).not.toHaveBeenCalled()
    blur({ currentTarget: { value: '200' } })
    expect(saveNodeSettings).toHaveBeenLastCalledWith('current', { name: 'Review', timeoutMs: 200, maxExecutions: 25 })
    blur({ currentTarget: { value: '' } })
    expect(saveNodeSettings).toHaveBeenLastCalledWith('current', { name: 'Review', maxExecutions: 25 })
    const limit = find(rendered, Input, (item) => item.props.id == 'node-current-limit')
    if (limit == null) throw new Error('Expected execution limit input.')
    const saveLimit = (limit.props as { readonly onBlur: (event: { currentTarget: { value: string } }) => void }).onBlur
    saveNodeSettings.mockClear()
    for (const value of ['25', '0', '-1', '1.5', 'Infinity', '9007199254740992']) saveLimit({ currentTarget: { value } })
    expect(saveNodeSettings).not.toHaveBeenCalled()
    saveLimit({ currentTarget: { value: '1000' } })
    expect(saveNodeSettings).toHaveBeenLastCalledWith('current', { name: 'Review', timeoutMs: 100, maxExecutions: 1000 })
    saveLimit({ currentTarget: { value: '' } })
    expect(saveNodeSettings).toHaveBeenLastCalledWith('current', { name: 'Review', timeoutMs: 100, maxExecutions: undefined })
  })
})

describe('Code task sections', () => {
  it.each(['shared', 'independent'] as const)('loads %s action metadata only when completion requests it', async (mode) => {
    const data = val({ data: [{ actionId: 'public.echo', serviceId: 'public', authenticated: false }], refreshing: false, error: undefined })
    const actions = vi.fn(() => data)
    const rendered = renderCodeSection({
      connectors: { $: { actions: { value: {} }, connections: { value: [] }, catalogs: { value: {} } } } as never,
      disabled: false,
      selection: {
        id: 'code',
        kind: 'task',
        module: { source: '' },
        definition: { moduleId: 'code', inputs: [], outputs: [], capabilities: [{ kind: 'connector', mode, actions: [] }] },
      } as never,
      store: {
        catalogs: {
          providers: {
            get: () => ({
              value: {
                data: [
                  { serviceId: 'public', noSetup: true },
                  { serviceId: 'other', noSetup: true },
                ],
              },
            }),
          },
          actions: { get: actions },
        },
        $: { flowId: { value: 'flow' }, moduleEditor: { value: { moduleId: 'code', source: '' } } },
      } as never,
      theme: 'light',
    })!
    expect(actions).not.toHaveBeenCalled()
    const feedback = find(rendered, ValueEditorFeedback, (item) => typeof item.props.children == 'function')!
    const editor = find(feedback.props.children(undefined), CodeEditor)!
    expect(editor.props.value).toBe('')
    const typing = await editor.props.prepareCompletion!()
    expect(typing).toContain('TaskContext')
    if (mode == 'shared') {
      expect(actions).toHaveBeenCalledTimes(2)
      expect(actions).toHaveBeenCalledWith('public', 'flow', 'en')
      expect(actions).toHaveBeenCalledWith('other', 'flow', 'en')
      expect(typing).toContain('public.echo')
      data.set({ ...data.value, data: [] })
      expect(actions).toHaveBeenCalledTimes(2)
    } else expect(actions).not.toHaveBeenCalled()
  })

  it.each(['independent', 'shared', 'missing'] as const)('saves selected action/account pairs from %s Code configuration', async (mode) => {
    const setCodeActions = vi.fn().mockResolvedValue(true)
    const rendered = renderCodeSection({
      connectors: { $: { actions: { value: {} }, connections: { value: [] }, catalogs: { value: {} } } } as never,
      disabled: false,
      selection: {
        id: 'code',
        kind: 'task',
        module: {},
        definition: { moduleId: 'code', inputs: [], outputs: [], capabilities: mode == 'missing' ? [] : [{ kind: 'connector', mode, actions: [] }] },
      } as never,
      store: {
        setCodeActions,
        catalogs: { providers: { get: () => ({ value: { data: [] } }) } },
        $: { flowId: { value: 'flow' }, moduleEditor: { value: { moduleId: 'code', source: '' } } },
      } as never,
      theme: 'light',
    })
    if (rendered == null) throw new Error('Expected Code settings.')
    const picker = find(rendered, ActionSelectionDialog, (item) => item.props.title == 'actionPicker.configureActions')
    if (picker == null) throw new Error('Expected Action selection dialog.')
    expect(setCodeActions).not.toHaveBeenCalled()
    const selected = [{ action: 'github.read', connectionId: 'work' }, { action: 'public.read' }]
    expect(await picker.props.onSave(selected)).toBe(true)
    expect(setCodeActions).toHaveBeenLastCalledWith('code', [{ kind: 'connector', mode: 'independent', actions: selected }])
    setCodeActions.mockResolvedValue(false)
    expect(await picker.props.onSave([])).toBe(false)
  })

  it('renders legacy Code with an editable permission mode and consecutive Node settings', async () => {
    const configureAccess = vi.fn()
    const setCodeActions = vi.fn().mockResolvedValue(true)
    const node = {
      kind: 'task',
      name: 'Transform',
      inputs: {},
      task: { name: 'Transform', moduleId: 'module', inputs: [], outputs: [] },
    }
    const definition = node.task
    const moduleEditor: {
      value: { moduleId: string; source: string; status: 'failed' | 'saved' }
    } = {
      value: { moduleId: 'module', source: 'export default () => ({})', status: 'saved' },
    }
    const diagnostics = [
      { code: 'module.syntax', column: 1, line: 2, message: 'Invalid JavaScript syntax.', path: '/modules/module/source' },
      { code: 'module.syntax', column: 1, line: 1, message: 'Another module is invalid.', path: '/modules/other/source' },
    ]
    const element = NodeInspector({
      variables: { enabled: true, names: [], loaded: true, loading: false, onOpen: vi.fn() },
      activeConnectorConnections: [],
      connectorAuthorizationPending: false,
      connectorLoading: false,
      connectors: { $: { actions: { value: {} }, connections: { value: [] }, catalogs: { value: {} } } } as never,
      disabled: false,
      diagnostics,
      onConfigureConnectorAccess: configureAccess,
      revision: { inputMappings: nodeInputMappings, graph: () => ({ nodes: { task: node } }) } as never,
      selection: {
        id: 'task',
        kind: 'task',
        node,
        definition,
        module: { name: 'Transform', imports: [], source: 'export default () => ({})' },
      } as never,
      store: {
        setCodeActions,
        catalogs: { providers: { get: () => ({ value: { data: [] } }) } },
        $: {
          flowId: { value: 'flow' },
          moduleEditor,
        },
      } as never,
      theme: 'light',
      triggerAuthorizationPending: false,
      triggerConnectionLoading: false,
      triggers: {} as never,
    })
    const task = find(element, CodeTaskSection)
    if (task == null || typeof task.type != 'function') throw new Error('Expected task definition.')
    const rendered = renderCodeSection(task.props)
    const actionsButton = (section: ReactElement) => find(find(section, ActionSelectionDialog)?.props.trigger, Button)
    expect(actionsButton(rendered)?.props.variant).toBe('ghost')
    const actionError = renderCodeSection({
      ...task.props,
      diagnostics: [
        {
          code: 'task.action-connection-required',
          path: '/document/graph/nodes/task/task/capabilities/0/actions/0/connectionId',
          line: 0,
          column: 0,
          message: 'Choose an account.',
        },
      ],
    })
    expect(actionsButton(actionError)?.props).toMatchObject({ 'variant': 'destructive', 'aria-invalid': true })
    const feedback = find(rendered, ValueEditorFeedback)
    expect(find(Children.toArray(feedback?.props.error)[0], 'div')?.props.children).toBe('Invalid JavaScript syntax.')
    expect(find(feedback?.props.children('syntax-error'), CodeEditor)?.props).toMatchObject({ ariaDescribedBy: 'syntax-error', invalid: true })
    const valid = renderCodeSection({ ...task.props, diagnostics: diagnostics.slice(1) })
    const validFeedback = find(valid, ValueEditorFeedback)
    expect(validFeedback?.props.error).toBeUndefined()
    expect(find(validFeedback?.props.children(undefined), CodeEditor)?.props.invalid).toBe(false)
    const modeSwitch = find(rendered, Switch, (item) => item.props.id == 'task-shared-permissions')
    expect(modeSwitch).toBeUndefined()
    expect(setCodeActions).not.toHaveBeenCalled()
    expect(find(rendered, TooltipTrigger, (item) => item.props.children == 'inspector.actions.flowAccess')).toBeUndefined()
    expect(configureAccess).not.toHaveBeenCalled()

    expect(find(element, GeneralSettings)).toBeDefined()
    const codeActions = (section: ReactElement) => find(section, 'div', (item) => String(item.props.className).includes('code-actions'))
    expect(codeActions(rendered)).toBeUndefined()

    moduleEditor.value = { ...moduleEditor.value, status: 'failed' }
    const failed = renderCodeSection(task.props)
    expect(codeActions(failed)).toBeDefined()
  })

  it('renders the LLM task definition as a standard section before Node settings', () => {
    const definition = {
      executor: { kind: 'llm', mode: 'chat' },
      inputs: [],
      name: 'Summarize',
      outputs: [{ handle: 'content', jsonSchema: { type: 'string' }, nullable: false }],
    }
    const node = { inputs: {}, kind: 'task', name: 'Summarize', task: definition }
    const element = NodeInspector({
      variables: { enabled: true, names: [], loaded: true, loading: false, onOpen: vi.fn() },
      activeConnectorConnections: [],
      connectorAuthorizationPending: false,
      connectorLoading: false,
      connectors: { $: { actions: { value: {} }, connections: { value: [] } } } as never,
      disabled: false,
      revision: { inputMappings: nodeInputMappings, graph: () => ({ nodes: { llm: node } }) } as never,
      selection: { id: 'llm', kind: 'task', node, definition } as never,
      store: { $: { flowId: { value: 'flow' }, moduleEditor: { value: undefined } } } as never,
      theme: 'light',
      triggerAuthorizationPending: false,
      triggerConnectionLoading: false,
      triggers: {} as never,
    })
    const task = find(element, LlmTaskSection)
    if (task == null || typeof task.type != 'function') throw new Error('Expected task definition.')
    const rendered = LlmTaskSection(task.props)
    expect(find(rendered, 'details')).toBeUndefined()
    expect(find(element, GeneralSettings)).toBeDefined()
  })
})

describe('Node input ownership', () => {
  it('resolves the selected upstream output description from the graph definition', () => {
    const input = { handle: 'message', jsonSchema: { type: 'string' }, nullable: false }
    const node = {
      kind: 'wait',
      name: 'Condition',
      inputDefinitions: [input],
      inputs: { message: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'upstream', output: 'title' }] } },
      cases: [],
    }
    const graph = {
      nodes: {
        condition: node,
        upstream: {
          kind: 'value',
          name: 'Source',
          values: [{ handle: 'title', description: 'The complete upstream title.', jsonSchema: { type: 'string' }, nullable: false }],
        },
      },
    }
    const element = NodeInspector({
      variables: { enabled: true, names: [], loaded: true, loading: false, onOpen: vi.fn() },
      connectorAuthorizationPending: false,
      connectorLoading: false,
      connectors: {} as never,
      disabled: false,
      revision: {
        inputMappings: nodeInputMappings,
        graph: () => graph,
        inputSource: () => ({ check: vi.fn(), candidates: vi.fn() }),
        outputDescription: () => 'The complete upstream title.',
      } as never,
      selection: { id: 'condition', kind: 'wait', node } as never,
      store: { $: { flowId: { value: 'flow' } } } as never,
      theme: 'light',
      triggerAuthorizationPending: false,
      triggerConnectionLoading: false,
      triggers: {} as never,
    })
    const inputs = find(element, NodeInputs)
    const upstream = inputs!.props.renderSource!('message')!

    expect(upstream.current).toEqual([
      {
        check: undefined,
        description: 'The complete upstream title.',
        icon: undefined,
        nodeId: 'upstream',
        nodeName: 'Source',
        output: 'title',
      },
    ])
  })

  it('does not expose a deleted upstream node ID as its display name', () => {
    const input = { handle: 'message', jsonSchema: { type: 'string' }, nullable: false }
    const node = {
      kind: 'wait',
      name: 'Condition',
      inputDefinitions: [input],
      inputs: { message: { kind: 'sources', sources: [{ kind: 'node', nodeId: '0199b784-internal', output: 'title' }] } },
      cases: [],
    }
    const element = NodeInspector({
      variables: { enabled: true, names: [], loaded: true, loading: false, onOpen: vi.fn() },
      connectorAuthorizationPending: false,
      connectorLoading: false,
      connectors: {} as never,
      disabled: false,
      revision: {
        inputMappings: nodeInputMappings,
        graph: () => ({ nodes: { condition: node } }),
        inputSource: () => ({ check: vi.fn(), candidates: vi.fn() }),
        outputDescription: () => undefined,
      } as never,
      selection: { id: 'condition', kind: 'wait', node } as never,
      store: { $: { flowId: { value: 'flow' } } } as never,
      theme: 'light',
      triggerAuthorizationPending: false,
      triggerConnectionLoading: false,
      triggers: {} as never,
    })
    const inputs = find(element, NodeInputs)
    const upstream = inputs!.props.renderSource!('message')!

    expect(upstream.current[0]?.nodeName).toBeUndefined()
  })

  it.each(['approval', 'wait', 'task'] as const)('resolves %s variable bindings and sends edits directly to the workspace', (kind) => {
    const setInputSource = vi.fn()
    const setInputValue = vi.fn()
    const setInputVariable = vi.fn()
    const node = {
      kind: 'wait',
      name: 'Condition',
      input: { handle: 'message', jsonSchema: { type: 'string' }, nullable: false },
      inputDefinitions: [{ handle: 'message', jsonSchema: { type: 'string' }, nullable: false }],
      inputs: { message: { kind: 'sources', sources: [{ kind: 'binding', bindingId: 'binding' }] } },
      cases: [],
    }
    const element = NodeInspector({
      variables: { enabled: true, names: ['API_TOKEN'], loaded: true, loading: false, onOpen: vi.fn() },
      connectorAuthorizationPending: false,
      connectorLoading: false,
      connectors: {} as never,
      disabled: false,
      revision: {
        inputMappings: nodeInputMappings,
        binding: () => ({ kind: 'variable', target: 'API_TOKEN' }),
        graph: () => ({ nodes: { upstream: { name: 'Source' } } }),
        inputSource: () => ({ check: vi.fn(), candidates: vi.fn() }),
      } as never,
      selection: {
        id: 'condition',
        kind,
        node: { ...node, kind, task: { name: 'Task', inputs: [node.input], outputs: [], executor: { kind: 'llm', mode: 'chat' } } },
        definition: { inputs: [node.input] },
      } as never,
      store: {
        $: { flowId: { value: 'flow' } },
        setInputSource,
        setInputValue,
        setInputVariable,
      } as never,
      theme: 'light',
      triggerAuthorizationPending: false,
      triggerConnectionLoading: false,
      triggers: {} as never,
    })
    const input = find(element, NodeInputs)
    expect(input).toBeDefined()
    const props = input!.props
    expect(props.allowAddGroup).toBe(kind !== 'wait' && kind !== 'approval')
    const upstream = props.renderSource!('message')!
    expect(upstream.groups).toEqual([])
    const outputs = [{ output: 'text', check: { kind: 'available' as const } }]
    expect(upstream.describeGroups!({ upstream: outputs })).toEqual([{ icon: undefined, nodeId: 'upstream', nodeName: 'Source', outputs }])
    upstream.onChange!({ nodeId: 'upstream', output: 'text' })
    expect(setInputSource).toHaveBeenCalledWith('condition', 'message', { nodeId: 'upstream', output: 'text' })
    const entry = props.entries[0]!
    if ('group' in entry) throw new Error('Expected input field.')
    expect(entry.variableName).toBe('API_TOKEN')
    expect(entry.connected).toBe(false)
    props.onValue('message', null)
    props.onVariable('message', undefined)
    expect(setInputValue).toHaveBeenCalledWith('condition', 'message', null, undefined)
    expect(setInputVariable).toHaveBeenCalledWith('condition', 'message', undefined)
  })
})

describe('OpenAPI configuration feedback', () => {
  it.each(['', 'https://api.example.test/spec.json'])('keeps the blocking error visible before loading %s', (sourceUrl) => {
    const load = vi.fn()
    const panel = OpenApiSection({
      task: { name: 'API', inputs: [], outputs: [], executor: { kind: 'openapi', sourceUrl, path: '', method: 'get', serverUrl: '', document: {}, auth: [] } },
      disabled: false,
      load,
      onSave: vi.fn(),
    })
    const feedback = find(panel, ValueEditorFeedback)!
    expect(feedback.props.error).toBe(sourceUrl ? 'openapi.loadRequired' : 'openapi.urlRequired')
    const input = find(feedback.props.children('error-id'), Input)!
    expect(input.props['aria-invalid']).toBe(true)
    expect(input.props['aria-describedby']).toBe('error-id')
    expect(find(panel, Button, (item) => item.props['aria-expanded'] != null)).toBeUndefined()
    expect(load).not.toHaveBeenCalled()
  })
})
