import type { RevisionContent, TriggerNode, Port } from '../src/flow/common/change.ts'

import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { currentEngineContract } from '../src/execution/common/runtime.ts'
import { runFlow } from '../src/execution/common/scheduler.ts'
import { applyFlowChanges, currentFlowModelVersion } from '../src/flow/common/change.ts'
import { decodeFlowDocument, decodeRevisionContent } from '../src/flow/common/changeSchema.ts'
import { decodeRevision, digestBytes, encodeRevision, upgradeRevisionContent, repairRevision, revisionRepairKind } from '../src/flow/common/encoding.ts'
import { inverseFlowChanges } from '../src/flow/common/inverseChanges.ts'
import { updateFlowInputDefs } from '../src/flow/common/nodeChanges.ts'
import { normalizeRunTrigger, prepareFlow } from '../src/flow/common/semantics.ts'
import { decodeWorkflowFile } from '../src/flow/common/workflowFile.ts'
import { matchesTriggerOutputs, normalizeTriggerOutputs } from '../src/trigger/common/contract.ts'

const start: Extract<TriggerNode, { kind: 'start' }> = {
  kind: 'start',
  name: 'Start',
}

const inputDefs: readonly Port[] = [
  { handle: 'message', jsonSchema: { type: 'string' }, nullable: false },
  { handle: 'note', jsonSchema: { type: 'string', default: 'unused' }, nullable: true },
]

function content(trigger: TriggerNode = start): RevisionContent {
  return {
    modelVersion: currentFlowModelVersion,
    modules: { code: { name: 'Code', imports: [], source: 'export default inputs => ({ result: inputs })' } },
    document: {
      inputDefs,
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
            task: { name: 'Code', moduleId: 'code', inputs: inputDefs, outputs: [{ handle: 'result', jsonSchema: {}, nullable: false }] },
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
    expect(normalizeTriggerOutputs(start, request, inputDefs)).toEqual({ message: 'hello', note: null })
    expect(request).toEqual({ message: 'hello' })
    expect(normalizeTriggerOutputs(start, { ...request, note: null }, inputDefs)).toEqual({ message: 'hello', note: null })
    expect(normalizeTriggerOutputs(start, { ...request, note: '' }, inputDefs)).toEqual({ message: 'hello', note: '' })
    expect(matchesTriggerOutputs(start, request, inputDefs)).toBe(false)
    expect(matchesTriggerOutputs(start, { ...request, note: null }, inputDefs)).toBe(true)
    expect(normalizeRunTrigger(content(), { nodeId: 'start', outputs: request })).toEqual({ nodeId: 'start', outputs: { ...request, note: null } })
  })

  it.each([{}, { message: null }, { message: 1 }, { message: 'hello', note: 2 }, { message: 'hello', extra: null }, { message: 'hello', note: undefined }])(
    'rejects missing required parameters and malformed or extra values: %j',
    (request) => {
      expect(normalizeTriggerOutputs(start, request, inputDefs)).toBeUndefined()
    },
  )

  it('keeps other Trigger output requirements and arbitrary literal parameter names', () => {
    const webhook: TriggerNode = { kind: 'webhook', name: 'Hook', method: 'POST', bodyFields: [] }
    expect(normalizeTriggerOutputs(webhook, { headers: {}, query: {}, body: {} }, [])).toBeUndefined()
    const unusualDefs = ['__proto__', 'constructor'].map((handle) => ({ handle, jsonSchema: {}, nullable: true }))
    const outputs = normalizeTriggerOutputs(start, {}, unusualDefs)!
    expect(Object.keys(outputs)).toEqual(['__proto__', 'constructor'])
    expect(Object.hasOwn(outputs, '__proto__')).toBe(true)
    expect(outputs.__proto__).toBeNull()
    expect(Object.getPrototypeOf(outputs)).toBe(Object.prototype)
    expect(normalizeTriggerOutputs(start, { message: 'hello' }, [inputDefs[0]!, inputDefs[0]!])).toBeUndefined()
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
    const settings = inputDefs.map((port) => (port.handle == 'note' ? Object.assign({}, port, { handle: 'comment' }) : port))
    const changes = updateFlowInputDefs(original, settings)
    const changed = applyFlowChanges(original, changes)
    expect(changed.document.graph.nodes.code).toHaveProperty('inputs.note.sources', [{ kind: 'node', nodeId: 'start', output: 'comment' }])
    expect(applyFlowChanges(changed, inverseFlowChanges(original, changes))).toEqual(original)
    const removed = applyFlowChanges(changed, updateFlowInputDefs(changed, [settings[0]!]))
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
          nodes: { ...source.document.graph.nodes, click: { ...source.document.graph.nodes.click, kind: 'start' } },
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
    ).toMatchObject({ kind: 'start', description: 'Updated' })
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
    expect(upgraded.document.graph.nodes.click).toEqual({ kind: 'start', name: 'Click', description: 'Purpose' })
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
      inputDefs: [{ handle: 'note', jsonSchema: { type: 'string' }, nullable: true }],
      bindings: {},
      graph: {
        nodes: {
          start: { kind: 'start', name: 'Start' },
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

it('changes revision and Start closure identities when workflow input definitions change', async () => {
  const source = content()
  const changed = applyFlowChanges(
    source,
    updateFlowInputDefs(
      source,
      inputDefs.map((port) => ({ ...port, description: 'Updated contract' })),
    ),
  )
  expect(encodeRevision(changed)).not.toEqual(encodeRevision(source))
  const before = await prepareFlow(source, currentEngineContract, 'start')
  const after = await prepareFlow(changed, currentEngineContract, 'start')
  if (before.kind != 'prepared' || after.kind != 'prepared') throw new Error('Expected prepared flows')
  expect(after.flow.closureDigest).not.toEqual(before.flow.closureDigest)
  expect(() => applyFlowChanges(changed, [{ kind: 'flow.input-defs.set', before: [], value: inputDefs }])).toThrow(/changed/)
})

function legacyStartContent(modelVersion = 7) {
  const source = content()
  const { inputDefs: parameters, ...document } = source.document
  return {
    ...source,
    modelVersion,
    document: {
      ...document,
      graph: {
        ...document.graph,
        nodes: { ...document.graph.nodes, start: { ...start, description: 'Original entry', icon: 'mdi:play', parameters } },
      },
    },
  }
}

function revisionBytes(value: object): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ kind: 'open-flow-flow-revision', version: 1, ...value }))
}

it.each([7, 8])('reads legacy Start parameters through shared boundaries and preserves edits in model %s', (modelVersion) => {
  const legacy = legacyStartContent(modelVersion)
  const before = structuredClone(legacy)
  const bytes = revisionBytes(legacy)
  const decoded = decodeRevision(bytes)
  const source = content()
  const expected = {
    ...source,
    modelVersion,
    document: {
      ...source.document,
      graph: {
        ...source.document.graph,
        nodes: { ...source.document.graph.nodes, start: { ...start, description: 'Original entry', icon: 'mdi:play' } },
      },
    },
  }
  expect(decoded).toEqual(expected)
  expect(decodeFlowDocument(legacy.document)).toEqual(expected.document)
  expect(decodeRevisionContent(legacy)).toEqual(expected)
  expect(decodeWorkflowFile({ kind: 'open-flow-workflow', version: 1, content: legacy }).content).toEqual(expected)
  expect(revisionRepairKind(bytes)).toBeUndefined()
  expect(repairRevision(bytes)).toEqual({ ...expected, modelVersion: currentFlowModelVersion })
  expect(decodeRevision(encodeRevision(decoded))).toEqual(expected)
  const changed = applyFlowChanges(decoded, [{ kind: 'graph.node.field.set', nodeId: 'start', field: 'name', before: 'Start', value: 'Renamed' }])
  expect(changed).toEqual({
    ...expected,
    modelVersion: currentFlowModelVersion,
    document: {
      ...expected.document,
      graph: { ...expected.document.graph, nodes: { ...expected.document.graph.nodes, start: { ...expected.document.graph.nodes.start, name: 'Renamed' } } },
    },
  })
  expect(legacy).toEqual(before)
  expect(revisionBytes(legacy)).toEqual(bytes)
})

it('executes legacy Start arguments with their schemas, nullability and downstream bindings intact', async () => {
  const decoded = decodeRevision(revisionBytes(legacyStartContent()))
  expect(normalizeRunTrigger(decoded, { nodeId: 'start', outputs: {} })).toBeUndefined()
  expect(normalizeRunTrigger(decoded, { nodeId: 'start', outputs: { message: 1 } })).toBeUndefined()
  const prepared = await prepareFlow(decoded, currentEngineContract, 'start')
  if (prepared.kind != 'prepared') throw new Error(JSON.stringify(prepared))
  const inputs: unknown[] = []
  await Effect.runPromise(
    runFlow(prepared.flow, {
      createId: () => crypto.randomUUID(),
      flowId: 'flow',
      runId: 'run',
      trigger: { nodeId: 'start', outputs: { message: 'Preserved' } },
      invokeTask: (invocation) =>
        Effect.sync(() => {
          inputs.push(invocation.input)
          return { result: invocation.input }
        }),
    }),
  )
  expect(inputs).toEqual([{ message: 'Preserved', note: null }])
})

it('accepts identical definitions and empty legacy parameters without inserting omitted current definitions', () => {
  const legacy = legacyStartContent()
  expect(decodeRevisionContent({ ...legacy, document: { ...legacy.document, inputDefs: structuredClone(inputDefs) } }).document.inputDefs).toEqual(inputDefs)
  const empty = { bindings: {}, graph: { nodes: { start: { ...start, parameters: [] } }, edges: [] } }
  expect(decodeFlowDocument(empty)).toEqual({ ...empty, inputDefs: [], graph: { ...empty.graph, nodes: { start } } })
  const { inputDefs: _defs, ...missing } = content().document
  expect(decodeFlowDocument(missing)).not.toHaveProperty('inputDefs')
})

it.each([null, {}, [{ ...inputDefs[0], value: 'would be lost' }], [{ handle: 'missing-schema' }]])(
  'rejects invalid legacy parameters without silently repairing them: %j',
  (parameters) => {
    const legacy = legacyStartContent()
    const invalid = { ...legacy, document: { ...legacy.document, graph: { ...legacy.document.graph, nodes: { start: { ...start, parameters } } } } }
    const bytes = revisionBytes(invalid)
    expect(() => decodeRevision(bytes)).toThrow()
    expect(() => repairRevision(bytes)).toThrow()
    expect(revisionRepairKind(bytes)).toBeUndefined()
  },
)

it.each(['workflow', 'another Start'])('rejects conflicting %s definitions without discarding either contract', (conflict) => {
  const legacy = legacyStartContent()
  const document =
    conflict == 'workflow'
      ? { ...legacy.document, inputDefs: [] }
      : { ...legacy.document, graph: { ...legacy.document.graph, nodes: { ...legacy.document.graph.nodes, other: { ...start, parameters: [] } } } }
  const bytes = revisionBytes({ ...legacy, document })
  expect(() => decodeRevision(bytes)).toThrow(/conflicts/)
  expect(() => repairRevision(bytes)).toThrow(/conflicts/)
  expect(revisionRepairKind(bytes)).toBeUndefined()
})

it('validates workflow definitions independently and keeps unrelated draft trigger scopes independent', async () => {
  const source: RevisionContent = {
    modelVersion: currentFlowModelVersion,
    modules: {},
    document: {
      inputDefs: [inputDefs[0]!, inputDefs[0]!],
      bindings: {},
      graph: { nodes: { start, timer: { kind: 'cron', name: 'Timer', cronTimes: [{ type: 'every', unit: 'hour', value: 1 }] } }, edges: [] },
    },
  }
  const invalid = await prepareFlow(source, currentEngineContract)
  expect(invalid).toMatchObject({ kind: 'flow-invalid', validation: { diagnostics: [expect.objectContaining({ path: '/document/inputDefs' })] } })
  const timer = await prepareFlow(source, currentEngineContract, 'timer')
  expect(timer.kind).toBe('prepared')
  const changed = { ...source, document: { ...source.document, inputDefs: [] } }
  const sameTimer = await prepareFlow(changed, currentEngineContract, 'timer')
  if (timer.kind != 'prepared' || sameTimer.kind != 'prepared') throw new Error('Expected timer preparation')
  expect(timer.flow.closureDigest).toEqual(sameTimer.flow.closureDigest)
  const noStart = { ...source, document: { ...source.document, graph: { nodes: {}, edges: [] } } }
  expect(await prepareFlow(noStart, currentEngineContract)).toMatchObject({
    kind: 'flow-invalid',
    validation: { diagnostics: [expect.objectContaining({ path: '/document/inputDefs' })] },
  })
})

it('preserves existing workflow definitions when migrating a manual node', () => {
  const legacy: RevisionContent = {
    modelVersion: 6,
    modules: {},
    document: { inputDefs, bindings: {}, graph: { nodes: { click: { kind: 'manual', name: 'Click' } }, edges: [] } },
  }
  expect(normalizeRunTrigger(legacy, { nodeId: 'click', outputs: {} })).toEqual({ nodeId: 'click', outputs: {} })
  const upgraded = upgradeRevisionContent(legacy)
  expect(upgraded.document.inputDefs).toEqual(inputDefs)
  expect(upgraded.document.graph.nodes.click).toEqual({ kind: 'start', name: 'Click' })
  expect(upgradeRevisionContent(upgraded)).toBe(upgraded)
})

it.each([undefined, []])('treats omitted and empty workflow inputs equally without inserting definitions: %j', async (definitions) => {
  const source: RevisionContent = {
    modelVersion: currentFlowModelVersion,
    modules: {},
    document: {
      ...(definitions == null ? {} : { inputDefs: definitions }),
      bindings: {},
      graph: { nodes: { start }, edges: [] },
    },
  }
  const encoded = encodeRevision(source)
  expect(decodeRevision(encoded)).toEqual(source)
  expect(upgradeRevisionContent(source)).toBe(source)
  expect(applyFlowChanges(source, [])).toEqual(source)
  const changed = applyFlowChanges(source, [{ kind: 'graph.node.field.set', nodeId: 'start', field: 'description', value: 'Entry' }])
  expect(Object.hasOwn(changed.document, 'inputDefs')).toBe(definitions != null)
  expect(normalizeRunTrigger(source, { nodeId: 'start', outputs: {} })).toEqual({ nodeId: 'start', outputs: {} })
  expect(normalizeRunTrigger(source, { nodeId: 'start', outputs: { undeclared: true } })).toBeUndefined()
  const prepared = await prepareFlow(source, currentEngineContract, 'start')
  if (prepared.kind != 'prepared') throw new Error('Expected zero-input Start to prepare')
  const explicit = await prepareFlow({ ...source, document: { ...source.document, inputDefs: [] } }, currentEngineContract, 'start')
  if (explicit.kind != 'prepared') throw new Error('Expected explicit empty inputs to prepare')
  expect(prepared.flow.closureDigest).toEqual(explicit.flow.closureDigest)
  const result = await Effect.runPromise(
    runFlow(prepared.flow, {
      createId: () => crypto.randomUUID(),
      flowId: 'flow',
      runId: 'run',
      trigger: { nodeId: 'start', outputs: {} },
      invokeTask: () => Effect.die('No task should run'),
    }),
  )
  expect(result.kind).toBe('node-results')
  expect(encodeRevision(source)).toEqual(encoded)
})
