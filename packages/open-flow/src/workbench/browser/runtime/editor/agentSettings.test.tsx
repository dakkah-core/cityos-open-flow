// @vitest-environment happy-dom
import type { Root } from 'react-dom/client'

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useVal } from 'use-value-enhancer'
import { I18nProvider } from 'val-i18n-react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createInspectorSession } from '../../../../../dev/designer/inspectorSession.ts'
import { applyFlowChanges, currentFlowModelVersion } from '../../../../flow/common/change.ts'
import { createAgentTask } from '../../../../flow/common/nodeChanges.ts'
import { AgentAdvancedSettings, AgentPrompt, AgentSettingsProvider } from './agentSettings.tsx'

// These tests exercise settings persistence; CodeMirror has its own editor coverage.
vi.mock('./promptEditor.tsx', () => ({ PromptEditor: () => null }))

const initial = applyFlowChanges(
  { modelVersion: currentFlowModelVersion, modules: {}, document: { bindings: {}, graph: { nodes: {}, edges: [] } } },
  createAgentTask({ nodeId: 'agent' }, 'Agent'),
)
let root: Root
let container: HTMLDivElement
let session: ReturnType<typeof createInspectorSession>
const log = vi.fn()

function Settings() {
  const revision = useVal(session.store.$.revision)
  const node = revision?.node('agent')
  if (node?.kind !== 'task' || node.definition == null || !('executor' in node.definition)) return null
  return (
    <I18nProvider i18n={session.i18n}>
      <AgentSettingsProvider task={node.definition} nodeId="agent" store={session.store} connectors={session.connectors} disabled={false} theme="light">
        <AgentPrompt />
        <AgentAdvancedSettings />
      </AgentSettingsProvider>
    </I18nProvider>
  )
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  log.mockClear()
  session = createInspectorSession('en', log, initial)
  await session.start()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<Settings />))
  log.mockClear()
})
afterEach(async () => {
  await act(async () => root.unmount())
  vi.restoreAllMocks()
  session.dispose()
  container.remove()
})
async function editModel(value: string) {
  const input = container.querySelector<HTMLInputElement>('#agent-model')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
}
function retryButton() {
  return [...container.querySelectorAll('button')].find((button) => button.textContent === session.i18n.t('inspector.task.retrySave'))
}
it('keeps failed Agent edits retryable without an inline operation error or duplicate notification', async () => {
  vi.spyOn(session.store.nodes, 'saveTaskSettings').mockImplementationOnce(async () => {
    session.store.notify({ kind: 'error', message: 'Save unavailable' })
    return false
  })
  await editModel('retry-model')
  expect(retryButton()).toBeDefined()
  expect(container.querySelector<HTMLInputElement>('#agent-model')!.value).toBe('retry-model')
  expect(container.querySelector('[role="alert"]')).toBeNull()
  expect(log.mock.calls.filter(([event]) => event === 'inspector.notice')).toEqual([['inspector.notice', { kind: 'error', message: 'Save unavailable' }]])
  await act(async () => retryButton()!.click())
  expect(retryButton()).toBeUndefined()
  const node = session.store.$.revision.value!.node('agent')
  expect(node?.kind === 'task' && node.definition != null && 'executor' in node.definition && node.definition.executor).toMatchObject({ model: 'retry-model' })
  expect(log.mock.calls.filter(([event]) => event === 'inspector.notice')).toEqual([['inspector.notice', { kind: 'error', message: 'Save unavailable' }]])
})
it('keeps invalid model feedback at the field and does not send a save request', async () => {
  const save = vi.spyOn(session.store.nodes, 'saveTaskSettings')
  await editModel('')
  expect(container.querySelector<HTMLInputElement>('#agent-model')!.getAttribute('aria-invalid')).toBe('true')
  expect(container.textContent).toContain(session.i18n.t('agent.modelRequired'))
  expect(save).not.toHaveBeenCalled()
  expect(retryButton()).toBeUndefined()
  expect(log.mock.calls.filter(([event]) => event === 'inspector.notice')).toHaveLength(0)
})
