// @vitest-environment happy-dom
import type { Root } from 'react-dom/client'

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { IconStack } from '../icon-stack.tsx'
import { ContentIcon, IconImageCrossOriginContext, imageIcon, initialsIcon, spriteIcon } from './ContentIcon.tsx'

vi.mock('./spriteResource.ts', () => ({ useSpriteStatus: () => 'failed' }))

let container: HTMLDivElement
let root: Root
const source = imageIcon('https://example.com/provider.png', initialsIcon('GH'))

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

it.each([undefined, 'anonymous'] as const)('uses the intended fallback for %s image reads', async (crossOrigin) => {
  await act(async () =>
    root.render(
      <IconImageCrossOriginContext.Provider value={crossOrigin}>
        <ContentIcon src={source} fallback={<span>Default node icon</span>} />
      </IconImageCrossOriginContext.Provider>,
    ),
  )
  const image = container.querySelector('img')!
  await act(async () => image.dispatchEvent(new Event('error')))
  expect(container.querySelector('img')).toBeNull()
  expect(container.textContent).toBe(crossOrigin ? 'Default node icon' : 'GH')
})

it('preserves Provider initials and action count after both sprite and image embedding fail', async () => {
  const icon = spriteIcon(
    {
      iconSprite: {
        version: 'v1',
        pixelRatio: 1,
        iconSize: 48,
        bleed: 0,
        width: 48,
        height: 48,
        lightUrl: 'https://example.com/sprite.png',
        darkUrl: 'https://example.com/sprite-dark.png',
      },
      iconSpritePosition: { x: 0, y: 0 },
    },
    source,
  )
  await act(async () =>
    root.render(
      <IconImageCrossOriginContext.Provider value="anonymous">
        <IconStack icons={[{ id: 'github', icon }]} count={2} size="sm" />
      </IconImageCrossOriginContext.Provider>,
    ),
  )
  const image = container.querySelector('img')!
  expect(image.crossOrigin).toBe('anonymous')
  await act(async () => image.dispatchEvent(new Event('error')))
  expect(container.querySelector('img')).toBeNull()
  expect(container.textContent).toContain('GH')
  expect(container.textContent).toContain('+2')
})
