// @vitest-environment happy-dom
import type { Root } from 'react-dom/client'
import type { WorkflowReferences } from '../../../../workflow/common/workflow.ts'
import type { FlowCatalogItem } from '../stores/flowCatalog.ts'

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from 'val-i18n-react'
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createI18n } from '../i18n.ts'
import { FlowReferencesButton } from './flowReferences.tsx'

const flow: FlowCatalogItem = {
  flowId: 'target',
  name: 'Target',
  version: 1,
  status: 'active',
  createdAt: '2026-10-16',
  updatedAt: '2026-10-16',
  draftRevisionId: 'draft',
  resourceReferences: { draft: null, sharedAccess: { accessRevision: 0, providerIds: [], bindings: [] } },
  referenceCount: 2,
}
const first: WorkflowReferences = {
  version: 1,
  direction: 'incoming',
  total: 2,
  nextOffset: 50,
  references: [{ flowId: 'outside-page', name: 'Both scopes', available: true, draft: true, live: { publicationId: 'p', enabled: false } }],
}
const last: WorkflowReferences = {
  version: 1,
  direction: 'incoming',
  total: 2,
  references: [
    ...first.references,
    { flowId: 'published', name: 'Published only', available: true, draft: false, live: { publicationId: 'p2', enabled: true } },
  ],
}
let root: Root
let container: HTMLDivElement
const i18n = createI18n('en')
afterAll(() => i18n.dispose())
const workspace = { getFlowReferences: vi.fn<(...args: [string, { offset?: number; signal?: AbortSignal }?]) => Promise<WorkflowReferences>>() }
const select = vi.fn()
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  workspace.getFlowReferences.mockReset()
  select.mockClear()
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
async function render(referenceCount: number | undefined = 2) {
  await act(async () =>
    root.render(
      <I18nProvider i18n={i18n}>
        <FlowReferencesButton
          flow={{ ...flow, referenceCount }}
          workspace={workspace}
          container={container}
          hrefForFlow={(item, view) => `/flows/${item.flowId}/${view}`}
          onSelectFlow={select}
        />
      </I18nProvider>,
    ),
  )
}
function button(text: string) {
  const value = Array.from(container.querySelectorAll('button')).find((item) => item.textContent == text || item.getAttribute('aria-label') == text)
  expect(value).toBeDefined()
  return value!
}
async function click(text: string) {
  await act(async () => button(text).click())
}

it('hides zero and unknown counts without requesting details', async () => {
  await render(0)
  expect(container.querySelector('button')).toBeNull()
  await act(async () =>
    root.render(
      <I18nProvider i18n={i18n}>
        <FlowReferencesButton
          flow={{ ...flow, referenceCount: undefined }}
          workspace={workspace}
          container={container}
          hrefForFlow={() => '/'}
          onSelectFlow={select}
        />
      </I18nProvider>,
    ),
  )
  expect(container.querySelector('button')).toBeNull()
  expect(workspace.getFlowReferences).not.toHaveBeenCalled()
})

it('loads on open, retries each page without losing rows, and links to each declaration scope', async () => {
  workspace.getFlowReferences
    .mockRejectedValueOnce(new Error('Failed'))
    .mockResolvedValueOnce(first)
    .mockRejectedValueOnce(new Error('Next failed'))
    .mockResolvedValueOnce(last)
  await render()
  expect(workspace.getFlowReferences).not.toHaveBeenCalled()
  await click('View referencing flows (2)')
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not load references.')
  await click('Retry')
  expect(workspace.getFlowReferences.mock.calls[1]?.[1]?.offset).toBe(0)
  expect(container.textContent).toContain('Published · Disabled')
  await click('Load more')
  expect(container.textContent).toContain('Both scopes')
  await click('Retry')
  expect(workspace.getFlowReferences.mock.calls.slice(2).map((call) => call[1]?.offset)).toEqual([50, 50])
  expect(container.querySelectorAll('li')).toHaveLength(2)
  expect(container.textContent).not.toContain('Load more')
  const links = Array.from(container.querySelectorAll('a'))
  const draft = links.find((link) => link.textContent == 'Both scopes')!
  const live = links.find((link) => link.textContent == 'Published only')!
  expect(draft.getAttribute('href')).toBe('/flows/outside-page/design')
  expect(live.getAttribute('href')).toBe('/flows/published/publications')
  await act(async () => draft.click())
  expect(select).toHaveBeenLastCalledWith(expect.objectContaining({ flowId: 'outside-page' }), 'design')
  const liveScope = links.find((link) => link.textContent == 'Published · Disabled')!
  await act(async () => liveScope.click())
  expect(select).toHaveBeenLastCalledWith(expect.objectContaining({ flowId: 'outside-page' }), 'publications')
  select.mockClear()
  await act(async () => draft.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })))
  expect(select).not.toHaveBeenCalled()
})

it('cancels pending requests on Escape and reloads after reopening', async () => {
  const pending = Promise.withResolvers<WorkflowReferences>()
  workspace.getFlowReferences.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ ...last, references: [] })
  await render()
  const trigger = button('View referencing flows (2)')
  await act(async () => {
    trigger.focus()
    trigger.click()
  })
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Loading references…')
  const signal = workspace.getFlowReferences.mock.calls[0]![1]!.signal!
  await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(signal.aborted).toBe(true)
  expect(document.activeElement).toBe(trigger)
  await click('View referencing flows (2)')
  expect(workspace.getFlowReferences).toHaveBeenCalledTimes(2)
  await act(async () => pending.resolve(first))
  expect(container.textContent).toContain('No flows reference this workflow.')
  expect(container.textContent).not.toContain('Both scopes')
})

it('discards the open session when the reference count disappears', async () => {
  const pending = Promise.withResolvers<WorkflowReferences>()
  workspace.getFlowReferences.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(last)
  await render()
  await click('View referencing flows (2)')
  const signal = workspace.getFlowReferences.mock.calls[0]![1]!.signal!
  await render(0)
  expect(signal.aborted).toBe(true)
  expect(container.querySelector('button')).toBeNull()
  await render(2)
  await act(async () => pending.resolve(first))
  expect(workspace.getFlowReferences).toHaveBeenCalledTimes(1)
  expect(container.querySelector('[role="dialog"]')).toBeNull()
  await click('View referencing flows (2)')
  expect(workspace.getFlowReferences).toHaveBeenCalledTimes(2)
  expect(container.textContent).toContain('Published only')
})
