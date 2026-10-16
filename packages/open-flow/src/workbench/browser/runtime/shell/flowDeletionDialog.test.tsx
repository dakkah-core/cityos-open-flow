// @vitest-environment happy-dom
import type { Root } from 'react-dom/client'
import type { WorkflowReferences } from '../../../../workflow/common/workflow.ts'
import type { ErrorListener } from '../api.ts'
import type { WorkspaceBusy } from '../stores/workspaceModel.ts'
import type { WorkspaceStore } from '../stores/workspaceStore.ts'

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from 'val-i18n-react'
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createI18n } from '../i18n.ts'
import { FlowDeletionDialog } from './flowDeletionDialog.tsx'

const empty: WorkflowReferences = { version: 1, direction: 'incoming', total: 0, references: [] }
const references: WorkflowReferences = {
  ...empty,
  total: 2,
  references: [
    { flowId: 'caller', name: 'Calling workflow', available: true, draft: true, live: { publicationId: 'p', enabled: false } },
    { flowId: 'live-only', name: 'Published caller', available: true, draft: false, live: { publicationId: 'p2', enabled: true } },
  ],
}
const i18n = createI18n('en')
afterAll(() => i18n.dispose())
let root: Root
let container: HTMLDivElement
const workspace = {
  getFlowReferences: vi.fn<WorkspaceStore['getFlowReferences']>(),
  getErrorListeners: vi.fn<WorkspaceStore['getErrorListeners']>(),
}
const onDelete = vi.fn()
const onClose = vi.fn()
const onSelect = vi.fn()
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  workspace.getFlowReferences.mockReset().mockResolvedValue(empty)
  workspace.getErrorListeners.mockReset().mockResolvedValue([])
  onDelete.mockClear()
  onClose.mockClear()
  onSelect.mockClear()
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
async function render(open = true, busy?: WorkspaceBusy) {
  await act(async () =>
    root.render(
      <I18nProvider i18n={i18n}>
        {open && (
          <FlowDeletionDialog
            flow={{ flowId: 'target', name: 'Target' }}
            workspace={workspace}
            container={container}
            busy={busy}
            finalFocus={() => null}
            onDelete={onDelete}
            onClose={onClose}
            onSelectFlow={onSelect}
            hrefForFlow={(item, view) => `/flows/${item.flowId}/${view}`}
          />
        )}
      </I18nProvider>,
    ),
  )
}
function button(text: string) {
  const item = Array.from(container.querySelectorAll('button')).find((element) => element.textContent == text)
  expect(item).toBeDefined()
  return item!
}
async function click(text: string) {
  await act(async () => button(text).click())
}

it('waits for both impact lookups, separates calls from error listeners, and requires explicit deletion', async () => {
  const pending = Promise.withResolvers<WorkflowReferences>()
  workspace.getFlowReferences.mockReturnValue(pending.promise)
  workspace.getErrorListeners.mockResolvedValue([{ flowId: 'handler', flowName: 'Error handler', nodeId: 'error', nodeName: 'Failure alert', enabled: false }])
  await render()
  expect(button('Delete').disabled).toBe(true)
  expect(workspace.getFlowReferences).toHaveBeenCalledWith('target', expect.objectContaining({ offset: 0, signal: expect.any(AbortSignal) }))
  await act(async () => pending.resolve(references))
  expect(container.textContent).toContain('Calls in 2 workflows will break')
  const details = Array.from(container.querySelectorAll('details'))
  expect(details).toHaveLength(2)
  expect(details.every((item) => !item.open)).toBe(true)
  await act(async () => details[0]!.querySelector('summary')!.click())
  expect(details[0]!.open).toBe(true)
  expect(container.textContent).toContain('Error handler')
  expect(container.textContent).toContain('Failure alert')
  expect(button('Delete anyway').disabled).toBe(false)
  const link = container.querySelector<HTMLAnchorElement>('a[href="/flows/caller/design"]')!
  await act(async () => link.click())
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ flowId: 'caller' }), 'design')
  expect(container.querySelector('a[href="/flows/live-only/publications"]')).not.toBeNull()
  expect(onDelete).not.toHaveBeenCalled()
  await click('Delete anyway')
  expect(onDelete).toHaveBeenCalledTimes(1)
  await render(true, 'flow')
  expect(button('Cancel').disabled).toBe(true)
  expect(button('Deleting…').disabled).toBe(true)
})

it('blocks deletion after a reference failure and enables ordinary deletion after an empty retry', async () => {
  workspace.getFlowReferences.mockRejectedValueOnce(new Error('Failed')).mockResolvedValueOnce(empty)
  await render()
  expect(button('Delete').disabled).toBe(true)
  await click('Delete')
  expect(onDelete).not.toHaveBeenCalled()
  await click('Retry')
  expect(workspace.getFlowReferences).toHaveBeenCalledTimes(2)
  expect(button('Delete').disabled).toBe(false)
  expect(container.textContent).not.toContain('will break')
  await click('Delete')
  expect(onDelete).toHaveBeenCalledOnce()
})

it('keeps deletion blocked until the independent error-listener query succeeds', async () => {
  const retry = Promise.withResolvers<readonly ErrorListener[]>()
  workspace.getFlowReferences.mockResolvedValue(references)
  workspace.getErrorListeners.mockRejectedValueOnce(new Error('Failed')).mockReturnValueOnce(retry.promise)
  await render()
  expect(button('Delete anyway').disabled).toBe(true)
  await click('Retry')
  expect(button('Delete anyway').disabled).toBe(true)
  expect(workspace.getFlowReferences).toHaveBeenCalledTimes(1)
  await act(async () => retry.resolve([]))
  expect(button('Delete anyway').disabled).toBe(false)
})

it('preserves loaded references but blocks deletion while a later page fails or is loading', async () => {
  const nextPage = Promise.withResolvers<WorkflowReferences>()
  workspace.getFlowReferences
    .mockResolvedValueOnce({ ...references, nextOffset: 50 })
    .mockReturnValueOnce(nextPage.promise)
    .mockResolvedValueOnce(references)
  await render()
  expect(button('Delete anyway').disabled).toBe(false)
  const details = container.querySelector('details')!
  await act(async () => details.querySelector('summary')!.click())
  await click('Load more')
  expect(button('Delete anyway').disabled).toBe(true)
  await act(async () => nextPage.reject(new Error('Failed')))
  await act(async () => details.querySelector('summary')!.click())
  expect(details.open).toBe(false)
  expect(container.querySelector('[role="alert"]')?.closest('details')).toBeNull()
  expect(container.textContent).toContain('Calling workflow')
  expect(button('Delete anyway').disabled).toBe(true)
  await click('Retry')
  expect(workspace.getFlowReferences.mock.calls.slice(1).map((call) => call[1]?.offset)).toEqual([50, 50])
  expect(button('Delete anyway').disabled).toBe(false)
})

it('cancels both lookups on close and starts fresh on every opening', async () => {
  const pendingReferences = Promise.withResolvers<WorkflowReferences>()
  const pendingListeners = Promise.withResolvers<readonly ErrorListener[]>()
  workspace.getFlowReferences.mockReturnValueOnce(pendingReferences.promise).mockResolvedValueOnce(references)
  workspace.getErrorListeners.mockReturnValueOnce(pendingListeners.promise).mockResolvedValueOnce([])
  await render()
  await click('Cancel')
  expect(onClose).toHaveBeenCalledOnce()
  await render(false)
  expect(workspace.getFlowReferences.mock.calls[0]![1]!.signal!.aborted).toBe(true)
  expect(workspace.getErrorListeners.mock.calls[0]![1]!.aborted).toBe(true)
  await render()
  await act(async () => {
    pendingReferences.resolve(empty)
    pendingListeners.resolve([])
  })
  expect(workspace.getFlowReferences).toHaveBeenCalledTimes(2)
  expect(workspace.getErrorListeners).toHaveBeenCalledTimes(2)
  expect(button('Delete anyway').disabled).toBe(false)
})
