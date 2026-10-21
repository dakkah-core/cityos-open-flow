// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { IconImageCrossOriginContext, imageIcon, initialsIcon } from '../../../../../ui/browser/icons/ContentIcon.tsx'
import { CanvasNodeIcon } from './CanvasNodeIcon.tsx'

vi.mock('../../../../../ui/browser/icons/IconifyIcon.tsx', () => ({
  IconifyIcon: ({ collection, icon }: { collection: string; icon: string }) => (
    <span>
      {collection}:{icon}
    </span>
  ),
}))

it.each(['connection-signal', 'machine-learning-model', 'code'])('uses the semantic %s fallback when Provider artwork cannot be embedded', async (icon) => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () =>
      root.render(
        <IconImageCrossOriginContext.Provider value="anonymous">
          <CanvasNodeIcon kind="task" icon={imageIcon('https://example.com/provider.png', initialsIcon('GH'))} fallbackIcon={`:carbon:${icon}:`} />
        </IconImageCrossOriginContext.Provider>,
      ),
    )
    await act(async () => container.querySelector('img')!.dispatchEvent(new Event('error')))
    expect(container.textContent).toBe(`carbon:${icon}`)
    expect(container.querySelector('img')).toBeNull()
  } finally {
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
  }
})
