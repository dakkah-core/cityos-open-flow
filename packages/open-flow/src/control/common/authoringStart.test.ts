import type { RevisionContent } from '../../flow/common/change.ts'
import type { AuthoringHost, AuthoringRequest } from './authoring.ts'

import * as Effect from 'effect/Effect'
import { expect, it } from 'vitest'
import { currentEngineContract } from '../../execution/common/runtime.ts'
import { runFlow } from '../../execution/common/scheduler.ts'
import { currentFlowModelVersion } from '../../flow/common/change.ts'
import { prepareFlow } from '../../flow/common/semantics.ts'
import { readAuthoring, authoringDiagnostics, authoringNode, authoringSchema, compileAuthoring, searchAuthoring } from './authoring.ts'

const empty: RevisionContent = {
  modelVersion: currentFlowModelVersion,
  modules: {},
  document: { bindings: {}, graph: { nodes: {}, edges: [] } },
}
const host: AuthoringHost = {
  id: (label) => label,
  action: async () => {
    throw new Error('Unused Action')
  },
  trigger: () => {
    throw new Error('Unused Trigger')
  },
  openapi: async () => {
    throw new Error('Unused OpenAPI')
  },
}
const compile = (base: RevisionContent, edits: AuthoringRequest['edits']) => compileAuthoring(base, { baseRevision: 'base', requestId: 'request', edits }, host)

it('authors Start parameters, preserves local updates, and supplies their values downstream', async () => {
  const created = await compile(empty, [
    {
      op: 'flow.update',
      set: {
        inputDefs: {
          amount: { schema: { type: 'number' }, nullable: false, description: 'Order total' },
          note: { schema: { type: 'string' }, nullable: true },
        },
      },
    },
    {
      op: 'node.add',
      as: 'start',
      type: 'start',
      name: 'Start',
    },
    {
      op: 'node.add',
      as: 'echo',
      type: 'code',
      name: 'Echo',
      code: 'export default input => ({result: input})',
      config: { outputs: { result: {} } },
      inputs: {
        amount: { kind: 'output', node: '$start', port: 'amount' },
        note: { kind: 'output', node: '$start', port: 'note' },
      },
    },
    { op: 'edge.connect', source: '$start', target: '$echo' },
  ])
  const start = created.nodes.start!
  const roundTrip = await compile(created.content, [
    { op: 'flow.update', set: { inputDefs: JSON.parse(JSON.stringify(readAuthoring(created.content).inputDefs)) } },
  ])
  expect(roundTrip.content).toEqual(created.content)
  const updated = await compile(created.content, [{ op: 'flow.update', set: { inputDefs: { amount: { description: 'Invoice total' } } } }])
  expect(readAuthoring(updated.content).inputDefs).toEqual({
    amount: { schema: { type: 'number' }, nullable: false, description: 'Invoice total' },
    note: { schema: { type: 'string' }, nullable: true },
  })
  expect(updated.content.document.graph.nodes[created.nodes.echo!]).toEqual(created.content.document.graph.nodes[created.nodes.echo!])
  expect(updated.content.document.graph.edges).toEqual(created.content.document.graph.edges)
  expect(searchAuthoring(updated.content, { query: 'Invoice total' }).matches).toContainEqual(expect.objectContaining({ field: 'inputDefs.amount' }))
  const renamed = await compile(updated.content, [
    {
      op: 'flow.update',
      set: { inputDefs: { total: { schema: { type: 'number' }, nullable: false, description: 'Invoice total' } } },
      clear: [['inputDefs', 'amount']],
    },
  ])
  const echo = renamed.content.document.graph.nodes[created.nodes.echo!]
  expect(echo != null && 'inputs' in echo ? echo.inputs.amount : undefined).toEqual({
    kind: 'sources',
    sources: [{ kind: 'node', nodeId: start, output: 'total' }],
  })
  const prepared = await prepareFlow(renamed.content, currentEngineContract)
  if (prepared.kind != 'prepared') throw new Error('Expected prepared Flow')
  const calls: unknown[] = []
  const result = await Effect.runPromise(
    runFlow(prepared.flow, {
      createId: () => crypto.randomUUID(),
      flowId: 'flow',
      runId: 'run',
      trigger: { nodeId: start, outputs: { total: 0 } },
      invokeTask: (invocation) =>
        Effect.sync(() => {
          calls.push(invocation.input)
          return { result: invocation.input }
        }),
    }),
  )
  expect(result.kind).toBe('node-results')
  expect(calls).toEqual([{ amount: 0, note: null }])
})

it('shares the Start schema example and reports its business parameter location', async () => {
  const unrestricted = await compile(empty, [
    { op: 'flow.update', set: { inputDefs: { value: {} } } },
    { op: 'node.add', as: 'start', type: 'start', name: 'Start' },
  ])
  expect(readAuthoring(unrestricted.content).inputDefs).toEqual({ value: { schema: {}, nullable: true } })
  const example = authoringSchema('start').example!
  const created = await compile(empty, [example as AuthoringRequest['edits'][number]])
  const start = created.nodes.step!
  expect(authoringNode(created.content, start)).toMatchObject({
    type: 'start',
    config: {},
  })
  const diagnostic = authoringDiagnostics(unrestricted.content, [
    { code: 'start.parameter-invalid', message: 'Invalid parameter.', path: '/document/inputDefs/0/jsonSchema/type', line: 1, column: 0 },
  ])
  expect(diagnostic[0]).toMatchObject({ nodes: [], field: 'inputDefs.value.schema.type' })
  await expect(
    compile(empty, [
      { op: 'flow.update', set: { inputDefs: JSON.parse('{"message":{"default":"hello"}}') } },
      { op: 'node.add', as: 'bad', type: 'start', name: 'Bad' },
    ]),
  ).rejects.toThrow()
  await expect(compile(created.content, [{ op: 'input.set', node: start, input: 'message', source: { kind: 'value', value: 'hello' } }])).rejects.toMatchObject(
    { code: 'input.not-found' },
  )
})

it('reads a legacy Manual node as Start and upgrades only the new authored Revision', async () => {
  const legacy: RevisionContent = {
    ...empty,
    modelVersion: 6,
    document: { bindings: {}, graph: { nodes: { old: { kind: 'manual', name: 'Click' } }, edges: [] } },
  }
  expect(authoringNode(legacy, 'old')).toMatchObject({ ref: 'old', type: 'start', config: {} })
  const updated = await compile(legacy, [{ op: 'node.update', node: 'old', set: { description: 'Entry' } }])
  expect(updated.content.document.graph.nodes.old).toEqual({ kind: 'start', name: 'Click', description: 'Entry' })
  expect(legacy.document.graph.nodes.old).toEqual({ kind: 'manual', name: 'Click' })
})

it('owns input definitions independently of Start and supports explicit clearing', async () => {
  const declared = await compile(empty, [{ op: 'flow.update', set: { inputDefs: { amount: { schema: { type: 'number', minimum: 0 }, nullable: false } } } }])
  expect(readAuthoring(declared.content).inputDefs).toEqual({ amount: { schema: { type: 'number', minimum: 0 }, nullable: false } })
  expect(searchAuthoring(declared.content, { query: 'amount' }).matches).toEqual([expect.objectContaining({ field: 'inputDefs.amount' })])
  const added = await compile(declared.content, [{ op: 'node.add', as: 'start', type: 'start', name: 'Start' }])
  const removed = await compile(added.content, [{ op: 'node.remove', node: added.nodes.start! }])
  expect(removed.content.document.inputDefs).toEqual(declared.content.document.inputDefs)
  const restored = await compile(removed.content, [{ op: 'node.add', as: 'start', type: 'start', name: 'Start' }])
  expect(authoringNode(restored.content, restored.nodes.start!).outputPorts).toEqual(readAuthoring(declared.content).inputDefs)
  const clearedSchema = await compile(restored.content, [{ op: 'flow.update', clear: [['inputDefs', 'amount', 'schema', 'minimum']] }])
  expect(readAuthoring(clearedSchema.content).inputDefs?.amount).toEqual({ schema: { type: 'number' }, nullable: false })
  const cleared = await compile(clearedSchema.content, [{ op: 'flow.update', clear: [['inputDefs']] }])
  expect(cleared.content.document.inputDefs).toEqual([])
  expect(authoringNode(cleared.content, restored.nodes.start!).outputPorts).toEqual({})
  await expect(compile(empty, [{ op: 'node.add', as: 'old', type: 'start', name: 'Start', config: { parameters: {} } }])).rejects.toThrow()
})

it('reads an omitted workflow contract as empty without adding it during unrelated edits', async () => {
  expect(empty.document).not.toHaveProperty('inputDefs')
  expect(readAuthoring(empty).inputDefs).toEqual({})
  const created = await compile(empty, [{ op: 'node.add', as: 'start', type: 'start', name: 'Start' }])
  expect(created.content.document).not.toHaveProperty('inputDefs')
  expect(readAuthoring(created.content).inputDefs).toEqual({})
  const updated = await compile(created.content, [{ op: 'node.update', node: created.nodes.start!, set: { description: 'Entry' } }])
  expect(updated.content.document).not.toHaveProperty('inputDefs')
})
