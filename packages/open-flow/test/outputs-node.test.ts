import type { AuthoringHost, AuthoringRequest } from '../src/control/common/authoring.ts'
import type { FlowRunOptions, SchedulerEvent } from '../src/execution/common/scheduler.ts'
import type { Graph, InputMapping, Port, RevisionContent } from '../src/flow/common/change.ts'

import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { authoringNode, authoringSchema, compileAuthoring, readAuthoring, searchAuthoring } from '../src/control/common/authoring.ts'
import { currentEngineContract } from '../src/execution/common/runtime.ts'
import { runFlow } from '../src/execution/common/scheduler.ts'
import { applyFlowChanges, currentFlowModelVersion } from '../src/flow/common/change.ts'
import { decodeRevision, encodeRevision, digestBytes } from '../src/flow/common/encoding.ts'
import { validateFlowGraph, inputSourceCandidates } from '../src/flow/common/graph.ts'
import { inverseFlowChanges } from '../src/flow/common/inverseChanges.ts'
import { deleteNodes, setInputVariable, updateFlowInputDefs, updateFlowOutputDefs } from '../src/flow/common/nodeChanges.ts'
import { flowClosure, flowDependencies, prepareFlow } from '../src/flow/common/semantics.ts'
import { advanceWaiting, waitHost } from './waitHost.ts'

const field = (handle: string): Port => ({ handle, jsonSchema: { type: 'number' }, nullable: false })
const source = (nodeId: string, output = 'value'): InputMapping => ({ kind: 'sources', sources: [{ kind: 'node', nodeId, output }] })
const value = (n: number) => ({ kind: 'value' as const, name: `Value ${n}`, inputs: {}, values: [{ ...field('value'), value: n }] })
function content(graph?: Graph): RevisionContent {
  return {
    modelVersion: currentFlowModelVersion,
    modules: {},
    document: {
      bindings: {},
      outputDefs: [field('answer')],
      outputMappings: { answer: source('value') },
      graph: graph ?? {
        nodes: { start: { kind: 'start', name: 'Start' }, value: value(42), outputs: { kind: 'outputs', name: 'Outputs' } },
        edges: [
          { source: 'start', target: 'value' },
          { source: 'value', target: 'outputs' },
        ],
      },
    },
  }
}
async function run(revision: RevisionContent, options: Partial<Pick<FlowRunOptions, 'emit' | 'invokeTask' | 'bindingValues'>> = {}) {
  const prepared = await prepareFlow(revision, currentEngineContract, 'start')
  if (prepared.kind != 'prepared') throw new Error(JSON.stringify(prepared))
  return Effect.runPromise(
    runFlow(prepared.flow, {
      createId: () => crypto.randomUUID(),
      flowId: 'flow',
      runId: 'run',
      trigger: { nodeId: 'start', outputs: {} },
      invokeTask: () => Effect.succeed({}),
      ...options,
    }),
  )
}
const host: AuthoringHost = {
  id: (label) => label,
  action: async () => {
    throw new Error('Unused')
  },
  trigger: () => {
    throw new Error('Unused')
  },
  openapi: async () => {
    throw new Error('Unused')
  },
}
const compile = (base: RevisionContent, edits: AuthoringRequest['edits']) => compileAuthoring(base, { baseRevision: 'base', requestId: 'request', edits }, host)

describe('workflow Outputs', () => {
  it('computes each loop invocation from its own snapshot and retains the final business output', async () => {
    const revision = content({
      nodes: {
        start: { kind: 'start', name: 'Start' },
        counter: {
          kind: 'task',
          inputs: { previous: source('counter', 'count') },
          task: { name: 'Counter', moduleId: 'counter', inputs: [{ handle: 'previous', jsonSchema: {}, nullable: true }], outputs: [field('count')] },
        },
        choose: {
          kind: 'condition',
          inputs: {},
          matchMode: 'first',
          cases: [
            {
              output: 'again',
              groups: [
                {
                  expressions: [
                    {
                      left: { kind: 'source', source: { kind: 'node', nodeId: 'counter', output: 'count' } },
                      operator: '<',
                      right: { kind: 'value', value: 3 },
                    },
                  ],
                },
              ],
            },
          ],
        },
        outputs: { kind: 'outputs', name: 'Outputs' },
      },
      edges: [
        { source: 'start', target: 'counter' },
        { source: 'counter', target: 'choose' },
        { source: 'choose', sourceHandle: 'again', target: 'counter' },
        { source: 'counter', target: 'outputs' },
      ],
    })
    const seen: unknown[] = []
    const result = await run(
      {
        ...revision,
        modules: { counter: { name: 'Counter', imports: [], source: 'export default () => ({count: 1})' } },
        document: { ...revision.document, outputMappings: { answer: source('counter', 'count') } },
      },
      {
        invokeTask: (call) => Effect.succeed({ count: Number(call.input.previous ?? 0) + 1 }),
        emit: (event) =>
          Effect.sync(() => {
            if (event.type == 'node.completed' && event.nodeId == 'outputs') seen.push(event.outputs.answer)
          }),
      },
    )
    expect(seen).toEqual([1, 2, 3])
    expect(result).toHaveProperty('outputs', { answer: 3 })
  })

  it('restores completed Outputs across a wait without executing it again', async () => {
    const base = content()
    const revision: RevisionContent = {
      ...base,
      document: {
        ...base.document,
        graph: {
          nodes: { ...base.document.graph.nodes, wait: { kind: 'wait', name: 'Wait', inputs: {}, inputDefinitions: [], prompt: 'Continue?' } },
          edges: [...base.document.graph.edges, { source: 'start', target: 'wait' }],
        },
      },
    }
    const prepared = await prepareFlow(revision, currentEngineContract, 'start')
    if (prepared.kind != 'prepared') throw new Error(JSON.stringify(prepared))
    const events: SchedulerEvent[] = []
    const shared = {
      createId: () => crypto.randomUUID(),
      flowId: 'flow',
      runId: 'run',
      invokeTask: () => Effect.succeed({}),
      emit: (event: SchedulerEvent) =>
        Effect.sync(() => {
          events.push(event)
        }),
    }
    const first = await advanceWaiting(runFlow(prepared.flow, { ...shared, trigger: { nodeId: 'start', outputs: {} }, waits: waitHost() }))
    if (first.kind != 'waiting') throw new Error('Expected wait checkpoint')
    expect(first.checkpoint.results.outputs?.outputs).toEqual({ answer: 42 })
    const result = await Effect.runPromise(
      runFlow(prepared.flow, {
        ...shared,
        resume: { checkpoint: JSON.parse(JSON.stringify(first.checkpoint)) },
        waits: waitHost({ [first.checkpoint.waits[0]!.waitId]: 'continue' }),
      }),
    )
    expect(result).toHaveProperty('outputs', { answer: 42 })
    expect(events.filter((event) => event.type == 'node.started' && event.nodeId == 'outputs')).toHaveLength(1)
  })
  it('round trips, contributes to semantic identity, and preserves legacy bytes', async () => {
    const revision = content()
    expect(decodeRevision(encodeRevision(revision))).toEqual(revision)
    const changed = applyFlowChanges(revision, [
      {
        kind: 'graph.node.input.set',
        nodeId: 'outputs',
        handle: 'answer',
        before: revision.document.outputMappings!.answer,
        value: { kind: 'value', value: 7 },
      },
    ])
    expect((await flowClosure(changed)).digest).not.toBe((await flowClosure(revision)).digest)
    const legacy: RevisionContent = {
      modelVersion: 7,
      modules: {},
      document: { bindings: {}, graph: { nodes: { start: { kind: 'start', name: 'Start' } }, edges: [] } },
    }
    const encoded = encodeRevision(legacy)
    expect(await digestBytes(encodeRevision(decodeRevision(encoded)))).toEqual(await digestBytes(encoded))
    expect(() => decodeRevision(encodeRevision({ ...revision, modelVersion: 7 }))).toThrow('version 8')
  })

  it('keeps business outputs alongside terminal node results and normal events', async () => {
    const events: SchedulerEvent[] = []
    const result = await run(content(), {
      emit: (event) =>
        Effect.sync(() => {
          events.push(event)
        }),
    })
    expect(result).toMatchObject({ kind: 'node-results', outputs: { answer: 42 }, nodes: [{ nodeId: 'outputs', outputs: { answer: 42 } }] })
    expect(events).toContainEqual(expect.objectContaining({ type: 'node.started', nodeKind: 'outputs', nodeId: 'outputs', inputs: { answer: 42 } }))
    expect(events).toContainEqual(expect.objectContaining({ type: 'node.completed', nodeId: 'outputs', outputs: { answer: 42 } }))
  })

  it('waits for both predecessors, then completes without terminating an independent branch', async () => {
    const right = Promise.withResolvers<Record<string, number>>()
    const unrelated = Promise.withResolvers<Record<string, number>>()
    const leftDone = Promise.withResolvers<void>()
    const outputDone = Promise.withResolvers<void>()
    const task = { kind: 'task' as const, inputs: {}, task: { name: 'Task', moduleId: 'main', inputs: [], outputs: [field('value')] } }
    const revision = content({
      nodes: { start: { kind: 'start', name: 'Start' }, left: task, right: task, unrelated: task, outputs: { kind: 'outputs', name: 'Outputs' } },
      edges: ['left', 'right', 'unrelated']
        .map((target) => ({ source: 'start', target }))
        .concat([
          { source: 'left', target: 'outputs' },
          { source: 'right', target: 'outputs' },
        ]),
    })
    const events: SchedulerEvent[] = []
    const execution = run(
      {
        ...revision,
        modules: { main: { name: 'Task', imports: [], source: 'export default () => ({value: 0})' } },
        document: { ...revision.document, outputDefs: [field('left'), field('right')], outputMappings: { left: source('left'), right: source('right') } },
      },
      {
        invokeTask: ({ nodeId }) =>
          nodeId == 'left' ? Effect.succeed({ value: 1 }) : Effect.promise(() => (nodeId == 'right' ? right.promise : unrelated.promise)),
        emit: (event) =>
          Effect.sync(() => {
            events.push(event)
            if (event.type == 'node.completed' && event.nodeId == 'left') leftDone.resolve()
            if (event.type == 'node.completed' && event.nodeId == 'outputs') outputDone.resolve()
          }),
      },
    )
    await leftDone.promise
    expect(events.some((event) => event.type == 'node.started' && event.nodeId == 'outputs')).toBe(false)
    right.resolve({ value: 2 })
    await outputDone.promise
    expect(events.some((event) => event.type == 'run.completed')).toBe(false)
    unrelated.resolve({ value: 3 })
    expect(await execution).toMatchObject({ outputs: { left: 1, right: 2 }, nodes: expect.arrayContaining([expect.objectContaining({ nodeId: 'unrelated' })]) })
  })

  it.each([true, false])('uses selected branches and skips inactive sources (%s)', async (selected) => {
    const revision = content({
      nodes: {
        start: { kind: 'start', name: 'Start' },
        condition: {
          kind: 'condition',
          inputs: {},
          matchMode: 'first',
          cases: [{ output: 'yes', groups: [{ expressions: [{ left: { kind: 'value', value: selected }, operator: 'isTrue' }] }] }],
        },
        yes: value(1),
        no: value(2),
        outputs: { kind: 'outputs', name: 'Outputs' },
      },
      edges: [
        { source: 'start', target: 'condition' },
        { source: 'condition', sourceHandle: 'yes', target: 'yes' },
        { source: 'condition', sourceHandle: 'otherwise', target: 'no' },
        { source: 'yes', target: 'outputs' },
        { source: 'no', target: 'outputs' },
      ],
    })
    const mapping: InputMapping = {
      kind: 'sources',
      sources: [
        { kind: 'node', nodeId: 'yes', output: 'value' },
        { kind: 'node', nodeId: 'no', output: 'value' },
      ],
    }
    expect(await run({ ...revision, document: { ...revision.document, outputMappings: { answer: mapping } } })).toMatchObject({
      outputs: { answer: selected ? 1 : 2 },
    })
    const skipped = {
      ...revision,
      document: {
        ...revision.document,
        outputMappings: { answer: { kind: 'value' as const, value: 0 } },
        graph: {
          ...revision.document.graph,
          edges: revision.document.graph.edges.filter((edge) => edge.target != 'outputs').concat([{ source: selected ? 'no' : 'yes', target: 'outputs' }]),
        },
      },
    }
    expect(await run(skipped)).not.toHaveProperty('outputs')
  })

  it('preserves definitions and variable references through deletion, rename and undo', () => {
    const revision = content()
    const variable = applyFlowChanges(revision, setInputVariable(revision, 'outputs', 'answer', 'TOKEN', 'binding')!)
    const removed = applyFlowChanges(variable, deleteNodes(variable, ['outputs']))
    expect(removed.document.outputMappings).toEqual(variable.document.outputMappings)
    expect(removed.document.bindings).toEqual(variable.document.bindings)
    const renamed = updateFlowOutputDefs(variable, [field('result')])
    expect(applyFlowChanges(variable, renamed).document.outputMappings).toEqual({ result: variable.document.outputMappings!.answer })
    expect(applyFlowChanges(applyFlowChanges(variable, renamed), inverseFlowChanges(variable, renamed))).toEqual(variable)
    expect([...flowDependencies(variable).bindings]).toEqual(['binding'])
    const fromStart = { ...revision, document: { ...revision.document, inputDefs: [field('amount')], outputMappings: { answer: source('start', 'amount') } } }
    expect(applyFlowChanges(fromStart, updateFlowInputDefs(fromStart, [field('total')])).document.outputMappings).toEqual({ answer: source('start', 'total') })
    expect(inputSourceCandidates(revision.document.graph, 'outputs', 'answer', [], revision.document).value).toMatchObject([
      { output: 'value', check: { kind: 'available' } },
    ])
  })

  it('rejects duplicate sinks, outgoing edges, invalid types, conflicting and missing sources', async () => {
    const revision = content()
    expect(() => applyFlowChanges(revision, [{ kind: 'graph.node.create', nodeId: 'another', node: { kind: 'outputs', name: 'Another' } }])).toThrow('only one')
    expect(() => applyFlowChanges(revision, [{ kind: 'graph.edge.connect', edge: { source: 'outputs', target: 'value' } }])).toThrow('downstream')
    const invalid = { ...revision, document: { ...revision.document, outputMappings: { answer: { kind: 'value' as const, value: 'wrong' } } } }
    await expect(run(invalid)).rejects.toThrow('declared schema')
    expect(validateFlowGraph({ ...revision, document: { ...revision.document, outputMappings: { answer: source('missing') } } })).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'graph.source-missing' })]),
    )
    const conflict: InputMapping = {
      kind: 'sources',
      sources: [
        { kind: 'node', nodeId: 'value', output: 'value' },
        { kind: 'node', nodeId: 'value', output: 'value' },
      ],
    }
    expect(validateFlowGraph({ ...revision, document: { ...revision.document, outputMappings: { answer: conflict } } })).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'graph.source-unavailable' })]),
    )
    expect(await run({ ...revision, document: { ...revision.document, outputDefs: [], outputMappings: {} } })).toHaveProperty('outputs', {})
    expect(
      await run({
        ...revision,
        document: { ...revision.document, outputDefs: [{ ...field('answer'), nullable: true }], outputMappings: { answer: { kind: 'unset' } } },
      }),
    ).toHaveProperty('outputs', { answer: null })
  })

  it('resolves variable and nested field sources and preserves literal output names', async () => {
    const revision = content()
    const mappings = Object.fromEntries([
      ['__proto__', { kind: 'value', value: { safe: true } }],
      ['constructor', { kind: 'sources', sources: [{ kind: 'binding', bindingId: 'token' }] }],
      ['nested', { kind: 'sources', sources: [{ kind: 'node', nodeId: 'start', output: 'record', field: 'count' }] }],
    ]) as Record<string, InputMapping>
    const changed: RevisionContent = {
      ...revision,
      document: {
        ...revision.document,
        inputDefs: [{ handle: 'record', jsonSchema: { type: 'object', properties: { count: { type: 'number' } }, required: ['count'] }, nullable: false }],
        bindings: { token: { kind: 'variable' as const, target: 'TOKEN' } },
        outputDefs: [
          { handle: '__proto__', jsonSchema: {}, nullable: false },
          { handle: 'constructor', jsonSchema: { type: 'string' }, nullable: false },
          field('nested'),
        ],
        outputMappings: mappings,
      },
    }
    const prepared = await prepareFlow(changed, currentEngineContract, 'start')
    if (prepared.kind != 'prepared') throw new Error(JSON.stringify(prepared))
    const result = await Effect.runPromise(
      runFlow(prepared.flow, {
        createId: () => crypto.randomUUID(),
        flowId: 'flow',
        runId: 'run',
        trigger: { nodeId: 'start', outputs: { record: { count: 0 } } },
        bindingValues: { token: 'value' },
        invokeTask: () => Effect.succeed({}),
      }),
    )
    expect(result).toHaveProperty('outputs', JSON.parse('{"__proto__":{"safe":true},"constructor":"value","nested":0}'))
  })

  it('authors, reads, locally edits and executes through public operations', async () => {
    const empty: RevisionContent = { modelVersion: currentFlowModelVersion, modules: {}, document: { bindings: {}, graph: { nodes: {}, edges: [] } } }
    const created = await compile(empty, [
      {
        op: 'flow.update',
        set: { inputDefs: { amount: { schema: { type: 'number' }, nullable: false } }, outputDefs: { total: { schema: { type: 'number' }, nullable: false } } },
      },
      { op: 'node.add', type: 'start', name: 'Start', as: 'start' },
      { op: 'node.add', type: 'outputs', name: 'Outputs', as: 'outputs', inputs: { total: { kind: 'output', node: '$start', port: 'amount' } } },
      { op: 'edge.connect', source: '$start', target: '$outputs' },
    ])
    const outputId = created.nodes.outputs!
    expect(authoringNode(created.content, outputId)).toMatchObject({
      type: 'outputs',
      config: {},
      inputPorts: { total: { schema: { type: 'number' } } },
      outputPorts: {},
    })
    expect(readAuthoring(created.content)).toMatchObject({
      outputMappings: { total: { kind: 'sources', sources: [{ kind: 'output', node: created.nodes.start, port: 'amount' }] } },
    })
    const changed = await compile(created.content, [{ op: 'flow.update', set: { outputDefs: { total: { description: 'Invoice total' } } } }])
    expect(changed.content.document.outputMappings).toEqual(created.content.document.outputMappings)
    expect(searchAuthoring(changed.content, { query: 'Invoice total' }).matches).toContainEqual(expect.objectContaining({ field: 'outputDefs.total' }))
    const prepared = await prepareFlow(changed.content, currentEngineContract, created.nodes.start!)
    if (prepared.kind != 'prepared') throw new Error(JSON.stringify(prepared))
    expect(
      await Effect.runPromise(
        runFlow(prepared.flow, {
          createId: () => crypto.randomUUID(),
          flowId: 'flow',
          runId: 'run',
          trigger: { nodeId: created.nodes.start!, outputs: { amount: 0 } },
          invokeTask: () => Effect.succeed({}),
        }),
      ),
    ).toHaveProperty('outputs', { total: 0 })
    await expect(compile(created.content, [{ op: 'input.set', node: outputId, input: 'unknown', source: { kind: 'value', value: 1 } }])).rejects.toMatchObject({
      code: 'input.not-found',
    })
    expect((await compile(empty, [authoringSchema('outputs').example as AuthoringRequest['edits'][number]])).content.document.graph.nodes).toHaveProperty(
      'node:step',
      { kind: 'outputs', name: 'Step' },
    )
  })
})
