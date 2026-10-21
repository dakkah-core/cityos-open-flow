// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { toast } from 'sonner'
import { I18n } from 'val-i18n'
import { I18nProvider } from 'val-i18n-react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AgentAccessPage } from '../browser/agent-access.tsx'
import en from '../browser/locales/en.json'
import { UsersPage } from '../browser/users.tsx'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
const i18n = new I18n('en', { en })
let root: Root
let container: HTMLDivElement
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
  vi.unstubAllGlobals()
})
async function render(content: ReactNode) {
  await act(async () => root.render(<I18nProvider i18n={i18n}>{content}</I18nProvider>))
}
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent === label)
  expect(button, label).toBeDefined()
  await act(async () => button!.click())
}
it.each([409, 500])('notifies once when updating a user fails with %i and keeps the user list', async (status) => {
  const user = { userId: 'other', email: 'example@example.com', role: 'user', enabled: true, revision: 1, createdAt: 1 }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input, init) => (init?.method === 'PUT' ? new Response(null, { status }) : Response.json({ version: 1, users: [user] }))),
  )
  await render(<UsersPage currentUserId="current" onUnauthorized={() => {}} />)
  await click(i18n.t('users.disable'))
  expect(toast.error).toHaveBeenCalledExactlyOnceWith(i18n.t(status === 409 ? 'users.conflict' : 'users.saveFailed'))
  expect(container.textContent).toContain(user.email)
  expect(container.querySelector('[role="alert"]')).toBeNull()
})
it('notifies once when revoking a token fails and keeps its retry action', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input, init) =>
      init?.method === 'DELETE'
        ? new Response(null, { status: 500 })
        : Response.json({ version: 1, tokens: [{ tokenId: 'token', name: 'Example token', createdAt: 1 }] }),
    ),
  )
  await render(<AgentAccessPage onUnauthorized={() => {}} />)
  await click(i18n.t('account.revoke'))
  await click(i18n.t('account.revoke'))
  expect(toast.error).toHaveBeenCalledExactlyOnceWith(i18n.t('account.saveFailed'))
  expect(container.textContent).toContain('Example token')
  expect(container.textContent).toContain(i18n.t('account.revokeConfirm'))
  expect(container.querySelector('[role="alert"]')).toBeNull()
})

it('keeps a failed user-list refresh visible when a later operation fails independently', async () => {
  const user = { userId: 'other', email: 'example@example.com', role: 'user', enabled: true, revision: 1, createdAt: 1 }
  const request = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ version: 1, users: [user] }))
    .mockResolvedValueOnce(new Response(null, { status: 409 }))
    .mockResolvedValueOnce(new Response(null, { status: 500 }))
    .mockResolvedValueOnce(new Response(null, { status: 500 }))
  vi.stubGlobal('fetch', request)
  await render(<UsersPage currentUserId="current" onUnauthorized={() => {}} />)
  await click(i18n.t('users.disable'))
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(i18n.t('users.loadFailed'))
  await click(i18n.t('users.resetPassword'))
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(i18n.t('users.loadFailed'))
  expect(toast.error).toHaveBeenNthCalledWith(1, i18n.t('users.conflict'))
  expect(toast.error).toHaveBeenNthCalledWith(2, i18n.t('users.saveFailed'))
})
