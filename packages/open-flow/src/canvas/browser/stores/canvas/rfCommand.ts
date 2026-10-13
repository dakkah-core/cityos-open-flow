import type { DisposableStore } from '@wopjs/disposable'
import type { ReactFlowInstance, XYPosition } from '@xyflow/react'
import type { ReadonlyReactiveMap } from 'value-enhancer/collections'
import type { NodeId } from '../../../../schema/index.ts'
import type { CanvasCommand } from '../../../common/commands.ts'
import type { RFNode } from '../../base/rfHelpers.ts'
import type { NodeStore } from '../node/node.store.ts'

import { disposableStore } from '@wopjs/disposable'
import { asArray, coalesce } from '../../base/trivial.ts'
import { getNodeMinimap, NodeMiniMapPhase } from './nodeMiniMap.ts'

export type RFCommandName = Exclude<keyof RFCommandImpl, keyof RFCommand>

export type CommandArgs<K extends RFCommandName> = RFCommandImpl[K] extends (rf: ReactFlowInstance, ...args: infer Args) => any ? Args : never

export interface RFCommand {
  readonly remoteViewportChange: boolean
  executeRemote(command: CanvasCommand): Promise<void>
  readonly dispose: DisposableStore
  send<K extends RFCommandName>(method: K, ...args: CommandArgs<K>): void
  onRFInstance(rf: ReactFlowInstance): () => void
}

/**
 * Sends commands from a CanvasStore to its React Flow instances.
 * One CanvasStore may control multiple React Flow instances.
 */
export const createRFCommand = (nodes: ReadonlyReactiveMap<NodeId, NodeStore>): RFCommand => new RFCommandImpl(nodes)

/**
 * Sends commands from a CanvasStore to its React Flow instances.
 * One CanvasStore may control multiple React Flow instances.
 *
 * To add a command such as `focusNode`, declare its first argument as a
 * ReactFlowInstance on RFCommandImpl. Calling
 * `designer.command.send("focusNode", nodeId)` then invokes it for every
 * registered instance.
 */
class RFCommandImpl implements RFCommand {
  public readonly dispose: DisposableStore = disposableStore()

  private readonly rfs = new Map<ReactFlowInstance, { pending?: Promise<void> }>()
  private remoteMoves = 0

  public get remoteViewportChange(): boolean {
    return this.remoteMoves > 0
  }

  public async executeRemote(command: CanvasCommand): Promise<void> {
    const executions: Promise<void>[] = []
    for (const [rf, registration] of this.rfs) {
      if (!rf.viewportInitialized) continue
      const run = async () => {
        if (this.rfs.get(rf) !== registration) return
        this.remoteMoves++
        try {
          switch (command.type) {
            case 'focus': {
              const node = this.nodes.get(command.nodeId as NodeId)?.$.rfNode.value
              if (node != null) await focusNodes(this.nodes.size, rf, [node], { duration: 0 })
              break
            }
            case 'zoom':
              await rf.zoomTo(command.zoom, { duration: 0 })
              break
            case 'pan': {
              const viewport = rf.getViewport()
              await rf.setViewport({ ...viewport, x: viewport.x + command.dx, y: viewport.y + command.dy }, { duration: 0 })
              break
            }
            case 'fit':
              if (rf.getNodes().length > 0) await rf.fitView({ padding: 0.15, maxZoom: 1, duration: 0 })
              break
          }
        } finally {
          this.remoteMoves--
        }
      }
      // Each pan reads the result of the preceding command, never a React render snapshot.
      const next = (registration.pending ?? Promise.resolve()).then(run, run)
      registration.pending = next
      executions.push(next)
    }
    await Promise.all(executions)
  }

  public readonly onRFInstance = (rf: ReactFlowInstance) => {
    const registration = {}
    this.rfs.set(rf, registration)
    return (): void => {
      if (this.rfs.get(rf) === registration) this.rfs.delete(rf)
    }
  }

  public send<K extends RFCommandName>(method: K, ...args: CommandArgs<K>): void {
    for (const rf of this.rfs.keys()) {
      ;(this[method] as any)(rf, ...args)
    }
  }

  public constructor(private readonly nodes: ReadonlyReactiveMap<NodeId, NodeStore>) {
    this.dispose.add(() => {
      this.rfs.clear()
    })
  }

  //#region Commands

  public focusNode(rf: ReactFlowInstance, nodeIds: NodeId | readonly NodeId[], options: { duration?: number } = { duration: 150 }): void {
    const nodes = coalesce(asArray(nodeIds).map((nodeId) => this.nodes.get(nodeId)?.$.rfNode.value))
    focusNodes(this.nodes.size, rf, nodes, options)
  }

  //#endregion
}

function getCenter(rfNode: RFNode): XYPosition {
  const x = rfNode.position.x ?? 0
  const y = rfNode.position.y ?? 0
  const width = rfNode.measured?.width ?? 400
  const height = rfNode.measured?.height ?? 200
  return { x: x + width / 2, y: y + height / 2 }
}

function focusNodes(nodesCount: number, rf: ReactFlowInstance, rfNodes: RFNode[], options: { duration?: number }) {
  if (!rfNodes.length) return

  if (rfNodes.length > 1) {
    return rf.fitBounds(rf.getNodesBounds(rfNodes), { duration: 150, padding: 0.15, ...options })
  } else {
    const rfNode = rfNodes[0]
    const center = getCenter(rfNode)
    const zoom = getNodeMinimap(nodesCount, rf.getZoom()) === NodeMiniMapPhase.None ? rf.getZoom() : 1
    return rf.setCenter(center.x, center.y, { zoom, ...options })
  }
}
