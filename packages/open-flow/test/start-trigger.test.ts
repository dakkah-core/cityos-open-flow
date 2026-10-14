import type { RevisionContent, TriggerNode } from '../src/flow/common/change.ts'

import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { currentEngineContract } from '../src/execution/common/runtime.ts'
import { runFlow } from '../src/execution/common/scheduler.ts'
import { applyFlowChanges, currentFlowModelVersion } from '../src/flow/common/change.ts'
import { decodeRevision, digestBytes, encodeRevision, upgradeRevisionContent } from '../src/flow/common/encoding.ts'
import { inverseFlowChanges } from '../src/flow/common/inverseChanges.ts'
import { updateTrigger } from '../src/flow/common/nodeChanges.ts'
import { normalizeRunTrigger, prepareFlow } from '../src/flow/common/semantics.ts'
import { matchesTriggerOutputs, normalizeTriggerOutputs } from '../src/trigger/common/contract.ts'

const start: Extract<TriggerNode, { kind: 'start' }> = {
  kind: 'start',
  name: 'Start',
  parameters: [
    { handle: 'message', jsonSchema: { type: 'string' }, nullable: false },
    { handle: 'note', jsonSchema: { type: 'string', default: 'unused' }, nullable: true },
  ],
}

function content(trigger: TriggerNode = start): RevisionContent {
  return {
    modelVersion: currentFlowModelVersion,
    modules: { code: { name: 'Code', imports: [], source: 'export default inputs => ({ result: inputs })' } },
    document: {
      bindings: {},
      graph: {
        nodes: {
          start: trigger,
          code: {
            kind: 'task',
            name: 'Code',
            inputs: {
              message: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'start', output: 'message' }] },
              note: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'start', output: 'note' }] },
            },
            task: { name: 'Code', moduleId: 'code', inputs: start.parameters, outputs: [{ handle: 'result', jsonSchema: {}, nullable: false }] },
          },
        },
        edges: [{ source: 'start', target: 'code' }],
      },
    },
  }
}

describe('Start parameters', () => {
  it('fills only omitted nullable fields, preserves explicit values and does not mutate the request', () => {
    const request = { message: 'hello' }
    expect(normalizeTriggerOutputs(start, request)).toEqual({ message: 'hello', note: null })
    expect(request).toEqual({ message: 'hello' })
    expect(normalizeTriggerOutputs(start, { ...request, note: null })).toEqual({ message: 'hello', note: null })
    expect(normalizeTriggerOutputs(start, { ...request, note: '' })).toEqual({ message: 'hello', note: '' })
    expect(matchesTriggerOutputs(start, request)).toBe(false)
    expect(matchesTriggerOutputs(start, { ...request, note: null })).toBe(true)
    expect(normalizeRunTrigger(content(), { nodeId: 'start', outputs: request })).toEqual({ nodeId: 'start', outputs: { ...request, note: null } })
  })

  it.each([{}, { message: null }, { message: 1 }, { message: 'hello', note: 2 }, { message: 'hello', extra: null }, { message: 'hello', note: undefined }])(
    'rejects missing required parameters and malformed or extra values: %j',
    (request) => {
      expect(normalizeTriggerOutputs(start, request)).toBeUndefined()
    },
  )

  it('keeps other Trigger output requirements and arbitrary literal parameter names', () => {
    const webhook: TriggerNode = { kind: 'webhook', name: 'Hook', method: 'POST', bodyFields: [] }
    expect(normalizeTriggerOutputs(webhook, { headers: {}, query: {}, body: {} })).toBeUndefined()
    const unusual: TriggerNode = {
      kind: 'start',
      name: 'Start',
      parameters: ['__proto__', 'constructor'].map((handle) => ({ handle, jsonSchema: {}, nullable: true })),
    }
    const outputs = normalizeTriggerOutputs(unusual, {})!
    expect(Object.keys(outputs)).toEqual(['__proto__', 'constructor'])
    expect(Object.hasOwn(outputs, '__proto__')).toBe(true)
    expect(outputs.__proto__).toBeNull()
    expect(Object.getPrototypeOf(outputs)).toBe(Object.prototype)
    expect(normalizeTriggerOutputs({ ...start, parameters: [start.parameters[0]!, start.parameters[0]!] }, { message: 'hello' })).toBeUndefined()
  })

  it('delivers complete outputs to downstream nodes through direct runFlow', async () => {
    const prepared = await prepareFlow(content(), currentEngineContract, 'start')
    if (prepared.kind != 'prepared') throw new Error(JSON.stringify(prepared))
    const inputs: unknown[] = []
    const result = await Effect.runPromise(
      runFlow(prepared.flow, {
        createId: () => crypto.randomUUID(),
        flowId: 'flow',
        runId: 'run',
        trigger: { nodeId: 'start', outputs: { message: 'hello' } },
        invokeTask: (invocation) =>
          Effect.sync(() => {
            inputs.push(invocation.input)
            return { result: invocation.input }
          }),
      }),
    )
    expect(inputs).toEqual([{ message: 'hello', note: null }])
    expect(result).toMatchObject({ kind: 'node-results', nodes: [{ nodeId: 'code', outputs: { result: { message: 'hello', note: null } } }] })
  })

  it('renames downstream references through the shared editor and preserves them when a parameter is deleted', () => {
    const original = content()
    const settings = { ...start, parameters: start.parameters.map((port) => (port.handle == 'note' ? Object.assign({}, port, { handle: 'comment' }) : port)) }
    const changes = updateTrigger(original, 'start', settings)!
    const changed = applyFlowChanges(original, changes)
    expect(changed.document.graph.nodes.code).toHaveProperty('inputs.note.sources', [{ kind: 'node', nodeId: 'start', output: 'comment' }])
    expect(applyFlowChanges(changed, inverseFlowChanges(original, changes))).toEqual(original)
    const removed = applyFlowChanges(changed, updateTrigger(changed, 'start', { ...settings, parameters: [settings.parameters[0]!] })!)
    expect(removed.document.graph.nodes.code).toHaveProperty('inputs.note.sources', [{ kind: 'node', nodeId: 'start', output: 'comment' }])
  })
})

describe('lossless Start upgrade', () => {
  it('inverts a legacy batch with a later complete manual snapshot while retaining its upgrade', () => {
    const trigger = { kind: 'manual', name: 'Start' } as const
    const source: RevisionContent = { modelVersion: 6, modules: {}, document: { bindings: {}, graph: { nodes: { start: trigger }, edges: [] } } }
    const changes = [
      { kind: 'module.create', moduleId: 'helper', module: { name: 'Helper', imports: [], source: 'export const value = 1' } },
      { kind: 'graph.node.replace', nodeId: 'start', before: trigger, node: { ...trigger, description: 'Changed' } },
    ] as const
    const changed = applyFlowChanges(source, changes)
    expect(applyFlowChanges(changed, inverseFlowChanges(source, changes))).toEqual(upgradeRevisionContent(source))
    expect(source.document.graph.nodes.start).toEqual(trigger)
  })
  it.each([2, 4, 5, 6] as const)('preserves model %s source bytes and converts manual nodes without changing identities', async (modelVersion) => {
    const source: RevisionContent = {
      modelVersion,
      modules: {},
      document: {
        bindings: {},
        graph: {
          nodes: {
            click: { kind: 'manual', name: 'Original name', description: 'Purpose', icon: ':carbon:play:' },
            data: { kind: 'value', inputs: {}, values: [] },
          },
          edges: [{ source: 'click', target: 'data' }],
        },
      },
    }
    const before = encodeRevision(source)
    const digest = await digestBytes(before)
    const upgraded = upgradeRevisionContent(decodeRevision(before))
    expect(upgraded).toEqual({
      ...source,
      modelVersion: currentFlowModelVersion,
      document: {
        ...source.document,
        graph: {
          ...source.document.graph,
          nodes: { ...source.document.graph.nodes, click: { ...source.document.graph.nodes.click, kind: 'start', parameters: [] } },
        },
      },
    })
    expect(encodeRevision(source)).toEqual(before)
    expect(await digestBytes(encodeRevision(source))).toBe(digest)
    expect(decodeRevision(encodeRevision(upgraded))).toEqual(upgraded)
    expect(upgradeRevisionContent(upgraded)).toBe(upgraded)
    expect(
      applyFlowChanges(source, [{ kind: 'graph.node.field.set', nodeId: 'click', field: 'description', before: 'Purpose', value: 'Updated' }]).document.graph
        .nodes.click,
    ).toMatchObject({ kind: 'start', parameters: [], description: 'Updated' })
  })

  it('rejects unreadable and retired structures instead of discarding them', () => {
    const source = content()
    expect(() => upgradeRevisionContent({ ...source, modelVersion: currentFlowModelVersion + 1 } as RevisionContent)).toThrow()
    expect(() => applyFlowChanges({ ...source, modelVersion: currentFlowModelVersion + 1 } as RevisionContent, [])).toThrow()
    expect(() => upgradeRevisionContent({ ...source, document: { ...source.document, subflows: { child: {} } } } as RevisionContent)).toThrow(/Subflow/)
  })

  it('uses the decoded legacy fields so the upgraded Revision remains readable', () => {
    const trigger = { kind: 'manual' as const, name: 'Click', description: 'Purpose', timeoutMs: 1000 }
    const source: RevisionContent = {
      modelVersion: 6,
      modules: {},
      document: { bindings: {}, graph: { nodes: { click: trigger }, edges: [] } },
    }
    const upgraded = upgradeRevisionContent(source)
    expect(upgraded.document.graph.nodes.click).toEqual({ kind: 'start', name: 'Click', description: 'Purpose', parameters: [] })
    expect(decodeRevision(encodeRevision(upgraded))).toEqual(upgraded)
    expect(applyFlowChanges(source, []).document.graph.nodes.click).toEqual(upgraded.document.graph.nodes.click)
    expect(source.document.graph.nodes.click).toBe(trigger)
    expect(trigger.timeoutMs).toBe(1000)
  })

  it('rejects an unreadable legacy node contract before replacing its model version', () => {
    const source: RevisionContent = {
      modelVersion: 2,
      modules: {},
      document: {
        bindings: {},
        graph: {
          nodes: { llm: { kind: 'task', name: 'LLM', inputs: {}, task: { name: 'LLM', inputs: [], outputs: [], executor: { kind: 'llm', mode: 'chat' } } } },
          edges: [],
        },
      },
    }
    expect(() => upgradeRevisionContent(source)).toThrow('Node-owned managed Tasks require Flow model version 6.')
    expect(() => applyFlowChanges(source, [])).toThrow('Node-owned managed Tasks require Flow model version 6.')
  })
})

afterEach(() => vi.useRealTimers())

it('persists a normalized Start seed in checkpoints and refuses to repair missing outputs on recovery', async () => {
  const revision: RevisionContent = {
    modelVersion: currentFlowModelVersion,
    modules: {},
    document: {
      bindings: {},
      graph: {
        nodes: {
          start: { kind: 'start', name: 'Start', parameters: [{ handle: 'note', jsonSchema: { type: 'string' }, nullable: true }] },
          wait: { kind: 'wait', name: 'Wait', prompt: 'Continue?', inputDefinitions: [], inputs: {} },
        },
        edges: [{ source: 'start', target: 'wait' }],
      },
    },
  }
  const prepared = await prepareFlow(revision, currentEngineContract)
  if (prepared.kind != 'prepared') throw new Error(JSON.stringify(prepared))
  vi.useFakeTimers()
  const options = {
    createId: () => crypto.randomUUID(),
    flowId: 'flow',
    runId: 'run',
    invokeTask: () => Effect.succeed({}),
    waits: {
      create: () => Effect.succeed(undefined),
      resolutions: (_ids: readonly string[], block: boolean) => (block ? Effect.never : Effect.succeed({})),
    },
  }
  const running = Effect.runPromise(runFlow(prepared.flow, { ...options, trigger: { nodeId: 'start', outputs: {} } }))
  await vi.advanceTimersByTimeAsync(120_000)
  const frozen = await running
  if (frozen.kind != 'waiting') throw new Error('Expected waiting')
  expect(frozen.checkpoint.results.start?.outputs).toEqual({ note: null })
  const damaged = structuredClone(frozen.checkpoint)
  Object.assign(damaged.results.start!, { outputs: {} })
  await expect(Effect.runPromise(runFlow(prepared.flow, { ...options, resume: { checkpoint: damaged } }))).rejects.toThrow(/Trigger output/)
  const waitId = frozen.checkpoint.waits[0]!.waitId
  const resumed = await Effect.runPromise(
    runFlow(prepared.flow, {
      ...options,
      waits: {
        ...options.waits,
        resolutions: () => Effect.succeed({ [waitId]: { action: 'continue' as const, comment: null, resolvedAt: '2026-10-14T00:00:00.000Z' } }),
      },
      resume: { checkpoint: frozen.checkpoint },
    }),
  )
  expect(resumed.kind).toBe('node-results')
})
