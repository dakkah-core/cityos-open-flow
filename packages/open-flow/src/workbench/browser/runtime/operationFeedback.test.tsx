// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'
import type { EventSource } from '../../../control/common/api.ts'

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from 'val-i18n-react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EventSourcesPage, SourceForm } from './eventSources.tsx'
import { EventSourceSetup } from './eventSourceSetup.tsx'
import { createI18n } from './i18n.ts'
import { WebhookCopyButton } from './publications/webhookEndpoint.tsx'

const source: EventSource = {
  version: 1,
  sourceId: 'source_demo',
  revision: 1,
  name: 'Demo events',
  provider: 'feishu_app_bot',
  appId: 'cli_demo',
  connectionId: 'connection',
  teamId: null,
  enabled: true,
  eventTypes: ['im.message.receive_v1'],
  manageSubscriptions: false,
  verificationTokenConfigured: true,
  encryptKeyConfigured: true,
  endpointUrl: 'https://flow.example/events',
  verifiedAt: null,
  lastReceivedAt: null,
  updatedAt: '2026-09-14T00:00:00.000Z',
  consumers: [],
}
const client = {
  listEventSources: vi.fn(async () => ({ version: 1 as const, sources: [source] })),
  listEventSourceConnections: vi.fn(async () => []),
  createConnectorConnectionPage: vi.fn(async () => 'https://connector.example'),
  createEventSource: vi.fn(async () => source),
  updateEventSource: vi.fn(async () => source),
  deleteEventSource: vi.fn(async () => {}),
}
let root: Root
let container: HTMLDivElement
const i18n = createI18n('en')
const notify = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})
async function render(content: ReactNode) {
  await act(async () => root.render(<I18nProvider i18n={i18n}>{content}</I18nProvider>))
}
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent === label)
  expect(button, label).toBeDefined()
  await act(async () => button!.click())
}
it('reports a failed source toggle without replacing the loaded list with an error', async () => {
  client.updateEventSource.mockRejectedValueOnce(new Error('Update unavailable'))
  await render(<EventSourcesPage client={client} language="en" teams={[]} notify={notify} />)
  await click(i18n.t('eventSources.disable'))
  expect(notify).toHaveBeenCalledExactlyOnceWith({ kind: 'error', message: 'Update unavailable' })
  expect(container.textContent).toContain(source.name)
  expect(container.querySelector('[role="alert"]')).toBeNull()
})
it('preserves the event source form after a failed save and permits retry', async () => {
  const onSaved = vi.fn()
  client.updateEventSource.mockRejectedValueOnce(new Error('Save unavailable'))
  await render(<SourceForm client={client} source={source} teams={[]} notify={notify} onSaved={onSaved} onCancel={() => {}} />)
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(notify).toHaveBeenCalledExactlyOnceWith({ kind: 'error', message: 'Save unavailable' })
  expect(onSaved).not.toHaveBeenCalled()
  expect(container.querySelector('form')).not.toBeNull()
  expect(container.querySelector('[role="alert"]')).toBeNull()
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(onSaved).toHaveBeenCalledWith(source)
})
it('reports verification request failure through notifications', async () => {
  client.listEventSources.mockRejectedValueOnce(new Error('Verification unavailable'))
  await render(<EventSourceSetup source={source} client={client} onChange={() => {}} notify={notify} />)
  await click(i18n.t('eventSources.checkVerification'))
  expect(notify).toHaveBeenCalledExactlyOnceWith({ kind: 'error', message: 'Verification unavailable' })
  expect(container.querySelector('[role="alert"]')).toBeNull()
})
it.each([false, true])('reports Webhook copy failure without inserting visible error text (icon: %s)', async (iconOnly) => {
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('Clipboard denied'))
  await render(<WebhookCopyButton endpointUrl={source.endpointUrl!} iconOnly={iconOnly} notify={notify} />)
  await act(async () => container.querySelector('button')!.click())
  expect(notify).toHaveBeenCalledExactlyOnceWith({ kind: 'error', message: i18n.t('webhookDeployment.copyFailed') })
  expect(container.textContent).not.toContain(i18n.t('webhookDeployment.copyFailed'))
})
