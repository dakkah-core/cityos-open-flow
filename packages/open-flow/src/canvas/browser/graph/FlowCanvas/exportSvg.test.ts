// @vitest-environment happy-dom
import type { ReactElement } from 'react'
import type { FlowCanvasProps } from './FlowCanvas.tsx'
import type { FlowCanvasViewModel } from './model.ts'

import { toSvg } from 'html-to-image'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadFlowSvg, flowToSvg } from './exportSvg.ts'

vi.mock('html-to-image', () => ({ toSvg: vi.fn() }))
vi.mock('./FlowCanvas.tsx', () => ({ FlowCanvas: () => null }))
vi.mock('react-dom/client', () => ({ createRoot: vi.fn() }))

const model: FlowCanvasViewModel = {
  viewport: { x: 900, y: -300, zoom: 0.1 },
  nodes: [{ id: 'task', kind: 'task', title: '客户反馈', position: { x: -300, y: 50 }, inputs: [], outputs: [], reference: 'task' }],
  edges: [],
}

const unmount = vi.fn()
let deferredImage: HTMLImageElement | undefined

beforeEach(() => {
  deferredImage = undefined
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } })
  vi.mocked(toSvg)
    .mockReset()
    .mockResolvedValue(
      'data:image/svg+xml;charset=utf-8,' +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">Rendered canvas</div></foreignObject></svg>',
        ),
    )
  // Simulate the browser's native measurement callback; appearance is verified in Lab.
  vi.mocked(createRoot).mockImplementation(
    (host) =>
      ({
        unmount,
        render(element) {
          let content = element as ReactElement<Partial<FlowCanvasProps> & { children: ReactElement }>
          while (!content.props.flowCanvasStore) content = content.props.children as typeof content
          const canvas = content.props as FlowCanvasProps
          const store = canvas.flowCanvasStore
          store.onInit()
          store.handleNodesChange(store.$.rfNodes.value.map((node) => ({ type: 'dimensions', id: node.id, dimensions: { width: 320, height: 120 } })))
          const surface = document.createElement('div')
          surface.className = 'react-flow'
          surface.style.backgroundColor = canvas.dark ? 'rgb(30, 30, 30)' : 'rgb(240, 240, 240)'
          surface.innerHTML = '<div class="react-flow__viewport"><div class="react-flow__node"></div><svg><path class="react-flow__edge-path" /></svg></div>'
          host.appendChild(surface)
          surface.querySelector('.react-flow__node')!.getBoundingClientRect = () => new DOMRect(-300, 50, 320, 120)
          Object.assign(surface.querySelector('.react-flow__edge-path')!, { getBBox: () => new DOMRect(-380, -40, 800, 250) })
          if (deferredImage) {
            const image = deferredImage
            const pending = document.createElement('span')
            pending.setAttribute('data-render-pending', '')
            surface.append(pending)
            setTimeout(() => {
              surface.append(image)
              pending.remove()
            }, 0)
          }
        },
      }) as ReturnType<typeof createRoot>,
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  document.body.replaceChildren()
  Reflect.deleteProperty(document, 'fonts')
})

describe('canvas SVG export', () => {
  it('captures all content and return lanes without changing the supplied viewport', async () => {
    const snapshot = structuredClone(model)
    const source = await flowToSvg(model, '<客户> & Review', 'zh-CN', { dark: true })
    expect(model).toEqual(snapshot)
    const svg = new DOMParser().parseFromString(source, 'image/svg+xml')
    expect(svg.querySelector('title')?.textContent).toBe('<客户> & Review')
    expect(svg.querySelector('foreignObject')?.textContent).toBe('Rendered canvas')
    expect(svg.querySelector('rect')?.getAttribute('fill')).toBe('rgb(30, 30, 30)')
    expect(toSvg).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ width: 928, height: 378 }))
    expect(unmount).toHaveBeenCalledOnce()
    expect(document.body.children).toHaveLength(0)
  })

  it('releases its isolated render surface when capture fails', async () => {
    vi.mocked(toSvg).mockRejectedValueOnce(new Error('Image unavailable'))
    await expect(flowToSvg(model, 'Workflow')).rejects.toThrow('Image unavailable')
    expect(unmount).toHaveBeenCalledOnce()
    expect(document.body.children).toHaveLength(0)
  })

  it('loads fallback images mounted after a sprite has finished loading', async () => {
    const image = document.createElement('img')
    image.loading = 'lazy'
    const decode = vi.fn(async () => {
      expect(image.loading).toBe('eager')
    })
    Object.assign(image, { decode })
    deferredImage = image
    await flowToSvg(model, 'Workflow')
    expect(decode).toHaveBeenCalledOnce()
  })

  it('declares UTF-8 in the standalone file even when its title is ASCII', async () => {
    const content = '开始 · 输出工作流 · 中文 🧩'
    vi.mocked(toSvg).mockResolvedValue(
      'data:image/svg+xml;charset=utf-8,' +
        encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">${content}</div></foreignObject></svg>`,
        ),
    )
    const source = await flowToSvg(model, 'aaa', 'zh-CN')
    expect(source).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>\n/)
    const svg = new DOMParser().parseFromString(source, 'image/svg+xml')
    expect(svg.querySelector('title')?.textContent).toBe('aaa')
    expect(svg.querySelector('foreignObject')?.textContent).toBe(content)
  })

  it('downloads an SVG with a safe filename and releases the temporary URL', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:sharing-svg')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('订单_客户.svg')
      expect(this.href).toBe('blob:sharing-svg')
    })
    await downloadFlowSvg(model, '订单/客户', 'zh-CN')
    expect(click).toHaveBeenCalledOnce()
    expect(create.mock.calls[0]![0]).toMatchObject({ type: 'image/svg+xml;charset=utf-8' })
    await new Promise((resolve) => setTimeout(resolve, 1))
    expect(revoke).toHaveBeenCalledWith('blob:sharing-svg')
    expect(document.body.children).toHaveLength(0)
  })
})
