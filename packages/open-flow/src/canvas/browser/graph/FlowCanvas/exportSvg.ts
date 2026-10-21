import type { FlowCanvasViewModel } from './model.ts'

import { toSvg } from 'html-to-image'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { IconImageCrossOriginContext } from '../../../../ui/browser/icons/ContentIcon.tsx'
import { IconifyProvider } from '../../../../ui/browser/icons/iconifyContext.tsx'
import { CanvasStore } from '../../stores/canvas/canvas.store.ts'
import { FlowCanvas } from './FlowCanvas.tsx'

export interface FlowSvgOptions {
  readonly dark?: boolean
  readonly ignoredNodeIds?: readonly string[]
}

const padding = 64
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

async function waitFor(ready: () => boolean): Promise<void> {
  const started = performance.now()
  while (!ready()) {
    if (performance.now() - started > 15000) throw new Error('Timed out rendering the workflow image.')
    await nextFrame()
  }
}

/** Render the real canvas at full detail without moving or changing the user's canvas. */
export async function flowToSvg(model: FlowCanvasViewModel, title: string, language = 'en', options: FlowSvgOptions = {}): Promise<string> {
  const positions = model.nodes.map((node) => node.position)
  const minX = Math.min(0, ...positions.map((position) => position.x))
  const minY = Math.min(0, ...positions.map((position) => position.y))
  const snapshot = { ...model, viewport: { x: padding - minX, y: padding - minY, zoom: 1 } }
  const host = document.createElement('div')
  // Every node starts inside this viewport, so off-screen placeholders never replace its content.
  Object.assign(host.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    pointerEvents: 'none',
    width: `${Math.max(0, ...positions.map((position) => position.x)) - minX + 1000}px`,
    height: `${Math.max(0, ...positions.map((position) => position.y)) - minY + 1000}px`,
  })
  host.inert = true
  host.setAttribute('aria-hidden', 'true')
  document.body.append(host)
  const root = createRoot(host)
  const store = new CanvasStore(snapshot, false, language, { onMoveNodes: () => {}, onChangeComment: () => {} })
  store.reconcile(snapshot, false, language, [], options.ignoredNodeIds ?? [])
  try {
    root.render(
      createElement(
        IconifyProvider,
        null,
        createElement(
          IconImageCrossOriginContext.Provider,
          { value: 'anonymous' },
          createElement(FlowCanvas, {
            flowCanvasStore: store,
            dark: options.dark ?? false,
            fitView: false,
            layoutMotion: false,
            nodesDraggable: false,
          }),
        ),
      ),
    )
    await waitFor(() => store.$.initialized.value && store.$.rfNodes.value.every((node) => !!node.measured?.width && !!node.measured.height))
    await waitFor(() => host.querySelector('[data-render-pending]') == null)
    // Include images mounted as a fallback after a sprite has failed.
    for (const image of host.querySelectorAll('img')) image.loading = 'eager'
    await Promise.all([...host.querySelectorAll('img')].map((image) => image.decode().catch(() => {})))
    await document.fonts.ready
    await nextFrame()
    await nextFrame()
    const viewport = host.querySelector<HTMLElement>('.react-flow__viewport')!
    const origin = viewport.getBoundingClientRect()
    const bounds = [...viewport.querySelectorAll<HTMLElement>('.react-flow__node')].map((node) => {
      const rect = node.getBoundingClientRect()
      return { x: rect.left - origin.left, y: rect.top - origin.top, width: rect.width, height: rect.height }
    })
    // Include wrapped and backward connections, which can extend past node bounds.
    for (const edge of viewport.querySelectorAll<SVGGraphicsElement>('.react-flow__edge-path')) bounds.push(edge.getBBox())
    const left = bounds.length ? Math.min(...bounds.map((rect) => rect.x)) : 0
    const top = bounds.length ? Math.min(...bounds.map((rect) => rect.y)) : 0
    const right = bounds.length ? Math.max(...bounds.map((rect) => rect.x + rect.width)) : 320
    const bottom = bounds.length ? Math.max(...bounds.map((rect) => rect.y + rect.height)) : 120
    const dataUrl = await toSvg(viewport, {
      width: Math.ceil(right - left + padding * 2),
      height: Math.ceil(bottom - top + padding * 2),
      preferredFontFormat: 'woff2',
      includeQueryParams: true,
      style: { transform: `translate(${padding - left}px, ${padding - top}px)`, transformOrigin: '0 0' },
    })
    const svg = new DOMParser().parseFromString(decodeURIComponent(dataUrl.slice(dataUrl.indexOf(',') + 1)), 'image/svg+xml')
    const background = svg.createElementNS('http://www.w3.org/2000/svg', 'rect')
    background.setAttribute('width', '100%')
    background.setAttribute('height', '100%')
    background.setAttribute('fill', getComputedStyle(host.querySelector('.react-flow')!).backgroundColor)
    const label = svg.createElementNS('http://www.w3.org/2000/svg', 'title')
    label.textContent = title
    svg.documentElement.prepend(label, background)
    // Native file previews do not receive the Blob's MIME charset.
    return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`
  } finally {
    root.unmount()
    store.dispose()
    host.remove()
  }
}

export async function downloadFlowSvg(model: FlowCanvasViewModel, title: string, language = 'en', options: FlowSvgOptions = {}): Promise<void> {
  const source = await flowToSvg(model, title, language, options)
  const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }))
  const link = document.createElement('a')
  // oxlint-disable-next-line no-control-regex
  link.download = `${title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '') || 'workflow'}.svg`
  link.href = url
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
