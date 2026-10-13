import type { ReactFlowInstance, Viewport } from '@xyflow/react'
import type { NodeId } from '../../../../schema/index.ts'
import type { NodeStore } from '../node/node.store.ts'

import { reactiveMap } from 'value-enhancer/collections'
import { expect, it, vi } from 'vitest'
import { createRFCommand } from './rfCommand.ts'

function setup(initialized = true) {
  const nodes = reactiveMap<NodeId, NodeStore>()
  const commands = createRFCommand(nodes)
  let viewport: Viewport = { x: 10, y: 20, zoom: 1 }
  const save = vi.fn()
  const move = (next: Viewport) => {
    viewport = next
    if (!commands.remoteViewportChange) save(next)
    return Promise.resolve(true)
  }
  const rf = {
    viewportInitialized: initialized,
    getViewport: () => viewport,
    getZoom: () => viewport.zoom,
    getNodes: () => [{ id: 'a', selected: true }, { id: 'b' }],
    setViewport: vi.fn(move),
    zoomTo: vi.fn((zoom: number) => move({ ...viewport, zoom })),
    fitView: vi.fn(async () => {
      await move({ x: 0, y: 0, zoom: 0.5 })
      return true
    }),
    setCenter: vi.fn(async () => true),
  }
  const stop = commands.onRFInstance(rf as unknown as ReactFlowInstance)
  return { commands, rf, stop, nodes, move, save }
}

it('executes each pan against the preceding viewport, preserving zoom without saving', async () => {
  const { commands, rf, move, save } = setup()
  await Promise.all([
    commands.executeRemote({ type: 'zoom', zoom: 0.8 }),
    commands.executeRemote({ type: 'pan', dx: 200, dy: -100 }),
    commands.executeRemote({ type: 'pan', dx: -50, dy: 20 }),
  ])
  expect(rf.getViewport()).toEqual({ x: 160, y: -60, zoom: 0.8 })
  expect(save).not.toHaveBeenCalled()
  expect(commands.remoteViewportChange).toBe(false)
  await move({ x: 161, y: -60, zoom: 0.8 })
  expect(save).toHaveBeenCalledOnce()
  commands.dispose()
})

it('fits all nodes regardless of selection and ignores absent focus targets', async () => {
  const { commands, rf } = setup()
  await commands.executeRemote({ type: 'fit' })
  await commands.executeRemote({ type: 'focus', nodeId: 'missing' })
  expect(rf.fitView).toHaveBeenCalledOnce()
  expect(rf.fitView).toHaveBeenCalledWith({ padding: 0.15, maxZoom: 1, duration: 0 })
  expect(rf.setCenter).not.toHaveBeenCalled()
  commands.dispose()
})

it('drops commands before initialization and after unmount without replay', async () => {
  const { commands, rf, stop } = setup(false)
  await commands.executeRemote({ type: 'pan', dx: 200, dy: 0 })
  rf.viewportInitialized = true
  const pending = commands.executeRemote({ type: 'pan', dx: 200, dy: 0 })
  stop()
  commands.onRFInstance(rf as unknown as ReactFlowInstance)
  await pending
  expect(rf.getViewport()).toEqual({ x: 10, y: 20, zoom: 1 })
  commands.dispose()
})

it('leaves an empty canvas unchanged when fitting', async () => {
  const { commands, rf } = setup()
  rf.getNodes = () => []
  await commands.executeRemote({ type: 'fit' })
  expect(rf.fitView).not.toHaveBeenCalled()
  expect(rf.getViewport()).toEqual({ x: 10, y: 20, zoom: 1 })
  commands.dispose()
})

it('reports a failed operation, releases transient state, and continues later commands', async () => {
  const { commands, rf, save, move } = setup()
  const error = new Error('Viewport unavailable')
  rf.zoomTo.mockRejectedValueOnce(error)
  const failed = commands.executeRemote({ type: 'zoom', zoom: 0.8 })
  const next = commands.executeRemote({ type: 'pan', dx: 20, dy: 10 })
  await expect(failed).rejects.toBe(error)
  await next
  expect(rf.getViewport()).toEqual({ x: 30, y: 30, zoom: 1 })
  expect(commands.remoteViewportChange).toBe(false)
  expect(save).not.toHaveBeenCalled()
  await move({ x: 40, y: 30, zoom: 1 })
  expect(save).toHaveBeenCalledOnce()
  commands.dispose()
})

it('an old attachment cleanup cannot detach its replacement', async () => {
  const { commands, rf, stop } = setup()
  const replacement = commands.onRFInstance(rf as unknown as ReactFlowInstance)
  stop()
  await commands.executeRemote({ type: 'pan', dx: 10, dy: 0 })
  expect(rf.getViewport().x).toBe(20)
  replacement()
  await commands.executeRemote({ type: 'pan', dx: 10, dy: 0 })
  expect(rf.getViewport().x).toBe(20)
  commands.dispose()
})
