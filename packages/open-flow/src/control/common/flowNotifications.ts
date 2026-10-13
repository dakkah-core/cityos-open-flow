import type { CanvasCommand } from '../../canvas/common/commands.ts'

export type FlowCatalogEvent =
  | { readonly kind: 'flows.changed'; readonly version: 1 }
  | { readonly kind: 'flow.created'; readonly flowId: string; readonly version: 1 }

export type FlowChangeEvent =
  | {
      readonly kind: 'canvas.command'
      readonly flowId: string
      readonly command: CanvasCommand
      readonly version: 1
    }
  | {
      readonly accessRevision: number
      readonly flowId: string
      readonly kind: 'access.changed'
      readonly version: 1
    }
  | {
      readonly kind: 'draft.changed'
      readonly flowId: string
      readonly revisionId: string
      readonly version: 1
    }
  | {
      readonly flowId: string
      readonly kind: 'run.created'
      readonly runId: string
      readonly version: 1
    }
  | {
      readonly flowId: string
      readonly kind: 'run.changed'
      readonly runId: string
      readonly version: 1
    }
