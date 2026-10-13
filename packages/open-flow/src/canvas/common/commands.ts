import { z } from 'zod'

export const canvasMinZoom = 0.1
export const canvasMaxZoom = 3

/** Transient operations on each connected canvas's own viewport. */
export const canvasCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('focus'), nodeId: z.string().min(1) }),
  z.strictObject({ type: z.literal('zoom'), zoom: z.number().min(canvasMinZoom).max(canvasMaxZoom) }),
  z.strictObject({ type: z.literal('pan'), dx: z.number(), dy: z.number() }),
  z.strictObject({ type: z.literal('fit') }),
])

export type CanvasCommand = z.infer<typeof canvasCommandSchema>
export type CanvasCommandSubscriber = (execute: (command: CanvasCommand) => void) => () => void
