import type { ChangeOperation } from '@oomol-lab/open-flow/flow-change'
import type { ServerService } from '../node/application/service.ts'
import type { Store } from '../node/storage/store.ts'

import { workflowTask } from '@oomol-lab/open-flow/workflow'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { workflowAuthoringTarget } from '../node/application/workflow.ts'
import { closeService, openService, startService } from './serviceFixture.ts'

const engine = 'open-flow-engine/v5'
const number = { handle: 'answer', jsonSchema: { type: 'number' }, nullable: false } as const
async function create(service: ServerService, name: string, operations: readonly ChangeOperation[]) {
  const created = await service.control.createFlow('operator', name, name)
  const flowId = created.flow.flowId
  const changed = await service.control.changeDraft('operator', flowId, created.flow.draftRevisionId, operations)
  return { flowId, revisionId: changed.revision.revisionId }
}
async function target(service: ServerService, wait = false) {
  await startService(service)
  const flow = await create(service, 'Target', [
    { kind: 'graph.node.create', nodeId: 'start', node: { kind: 'start', name: 'Start' } },
    { kind: 'flow.input-defs.set', before: [], value: [number] },
    { kind: 'flow.output-defs.set', value: [number] },
    { kind: 'flow.output-mappings.set', value: { answer: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'start', output: 'answer' }] } } },
    { kind: 'graph.node.create', nodeId: 'outputs', node: { kind: 'outputs', name: 'Outputs' } },
    ...(wait
      ? [
          {
            kind: 'graph.node.create' as const,
            nodeId: 'wait',
            node: { kind: 'wait' as const, name: 'Wait', inputs: {}, inputDefinitions: [], prompt: 'Continue' },
          },
          { kind: 'graph.edge.connect' as const, edge: { source: 'start', target: 'wait' } },
          { kind: 'graph.edge.connect' as const, edge: { source: 'wait', sourceHandle: 'continue', target: 'outputs' } },
        ]
      : [{ kind: 'graph.edge.connect' as const, edge: { source: 'start', target: 'outputs' } }]),
  ])
  const published = await service.control.publishFlow('operator', flow.flowId, flow.revisionId, engine, null, 'publish')
  await expect.poll(() => service.control.getPublishOperation(flow.flowId, published.operationId).status).toBe('succeeded')
  return flow
}
async function caller(service: ServerService, flowId: string, timeoutMs?: number, name = 'Caller') {
  const contract = service.control.getWorkflowContract('operator', flowId)
  return create(service, name, [
    { kind: 'graph.node.create', nodeId: 'start', node: { kind: 'start', name: 'Start' } },
    {
      kind: 'graph.node.create',
      nodeId: 'call',
      node: {
        kind: 'task',
        name: 'Target',
        ...(timeoutMs == null ? {} : { timeoutMs }),
        inputs: { answer: { kind: 'value', value: 42 } },
        task: workflowTask(contract),
      },
    },
    { kind: 'graph.edge.connect', edge: { source: 'start', target: 'call' } },
  ])
}

it('calls current Live with one execution slot, preserves separate events and durable origin', async () => {
  const service = await openService(':memory:', { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  const child = await target(service)
  const parent = await caller(service, child.flowId)
  const refs = service.control.getFlowReferences('operator', child.flowId, 'incoming', 0, 50)
  expect(refs.references).toMatchObject([{ flowId: parent.flowId, draft: true, live: null }])
  const accepted = await service.control.runs.createDraftRun(parent.flowId, parent.revisionId, engine, {}, 'call', { nodeId: 'start', outputs: {} })
  await expect.poll(() => service.control.runs.getRun(accepted.run.runId).status).toBe('completed')
  const run = service.control.runs.getRun(accepted.run.runId)
  expect(run.triggerNodeId).toBe('start')
  expect(run.calls).toHaveLength(1)
  expect(service.control.runs.getRunEvents(run.runId, 0, 100).events.find((event) => event.kind == 'node.started')?.payload.executionId).toBe(
    run.calls![0]!.executionId,
  )
  const call = run.calls![0]!
  expect(service.control.runs.getRun(call.runId)).toMatchObject({
    source: 'live',
    triggerNodeId: 'start',
    caller: { runId: run.runId, flowId: parent.flowId, nodeId: 'call', executionId: call.executionId },
  })
  expect(service.run(run.runId)?.result).toMatchObject({ nodes: [{ nodeId: 'call', outputs: { answer: 42 } }] })
  expect(service.events(run.runId).some((event) => event.payload.nodeId == 'outputs')).toBe(false)
  expect(service.events(call.runId).some((event) => event.payload.nodeId == 'outputs')).toBe(true)
  const store = (service.control as unknown as { store: Store }).store
  store.runs.maintain(Date.now() + 31 * 24 * 60 * 60 * 1000, 100, 1000)
  expect(service.events(run.runId)).toEqual([])
  expect(service.control.runs.getRun(call.runId).caller?.executionId).toBe(call.executionId)
  expect(service.control.runs.getRun(run.runId).calls).toHaveLength(1)
})

it('keeps the parent pending while a child waits for a human and resumes without another child', async () => {
  const service = await openService(':memory:', { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  const child = await target(service, true)
  const parent = await caller(service, child.flowId)
  const accepted = await service.control.runs.createDraftRun(parent.flowId, parent.revisionId, engine, {}, 'call', { nodeId: 'start', outputs: {} })
  await expect.poll(() => service.control.runs.getRun(accepted.run.runId).calls?.length).toBe(1)
  const call = service.control.runs.getRun(accepted.run.runId).calls![0]!
  await expect.poll(() => service.control.runs.getRun(call.runId).waits.length).toBe(1)
  expect(service.control.runs.getRun(accepted.run.runId).status).toBe('waiting')
  const wait = service.control.runs.getRun(call.runId).waits[0]!
  service.control.runs.resolveRunWait(call.runId, wait.waitId, 'continue')
  await expect.poll(() => service.control.runs.getRun(accepted.run.runId).status).toBe('completed')
  expect(service.control.runs.getRun(accepted.run.runId).calls).toHaveLength(1)
})

it('cancels a waiting child with its caller and refuses other owners', async () => {
  const service = await openService(':memory:', { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  const child = await target(service, true)
  expect(() => service.control.getWorkflowContract('someone-else', child.flowId)).toThrow()
  const parent = await caller(service, child.flowId)
  const accepted = await service.control.runs.createDraftRun(parent.flowId, parent.revisionId, engine, {}, 'call', { nodeId: 'start', outputs: {} })
  await expect.poll(() => service.control.runs.getRun(accepted.run.runId).calls?.length).toBe(1)
  const call = service.control.runs.getRun(accepted.run.runId).calls![0]!
  service.control.runs.cancelRun(accepted.run.runId)
  await expect.poll(() => service.control.runs.getRun(call.runId).status).toBe('canceled')
})

it('enforces the call deadline while the child is waiting', async () => {
  const service = await openService(':memory:', { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  const child = await target(service, true)
  const parent = await caller(service, child.flowId, 800)
  const accepted = await service.control.runs.createDraftRun(parent.flowId, parent.revisionId, engine, {}, 'timeout', { nodeId: 'start', outputs: {} })
  await expect.poll(() => service.control.runs.getRun(accepted.run.runId).status).toBe('failed')
  const run = service.control.runs.getRun(accepted.run.runId)
  expect(run.calls).toHaveLength(1)
  expect(run.calls![0]!.status).toBe('canceled')
  expect(service.run(run.runId)?.result).toMatchObject({ error: { code: 'run.timeout' } })
})

it('resumes a persisted parent after restart without starting another child', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'workflow-call-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'flow.sqlite')
  const service = await openService(file, { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  const child = await target(service)
  const parent = await caller(service, child.flowId)
  const store = (service.control as unknown as { store: Store }).store
  const claim = store.runs.claim.bind(store.runs)
  const held = vi
    .spyOn(store.runs, 'claim')
    .mockImplementation((excluded) =>
      claim(store.runViews.listControlRuns(parent.flowId, 1)[0]?.startedAt != null ? [...(excluded ?? []), parent.flowId] : excluded),
    )
  const accepted = await service.control.runs.createDraftRun(parent.flowId, parent.revisionId, engine, {}, 'restart', { nodeId: 'start', outputs: {} })
  await expect.poll(() => service.control.runs.getRun(accepted.run.runId).calls?.[0]?.status).toBe('completed')
  expect(service.control.runs.getRun(accepted.run.runId).status).toBe('queued')
  const original = service.control.runs.getRun(accepted.run.runId).calls![0]!
  await closeService(service)
  held.mockRestore()
  const reopened = await openService(file, { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  await startService(reopened)
  await expect.poll(() => reopened.control.runs.getRun(accepted.run.runId).status).toBe('completed')
  expect(reopened.control.runs.getRun(accepted.run.runId).calls).toEqual([original])
  expect(reopened.events(accepted.run.runId).filter((event) => event.kind == 'node.started')).toHaveLength(1)
})

it('propagates an unconfirmed child after restart without replaying it', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'workflow-unknown-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'flow.sqlite')
  const service = await openService(file, { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  const child = await target(service, true)
  const parent = await caller(service, child.flowId)
  const accepted = await service.control.runs.createDraftRun(parent.flowId, parent.revisionId, engine, {}, 'unknown', { nodeId: 'start', outputs: {} })
  await expect.poll(() => service.control.runs.getRun(accepted.run.runId).calls?.length).toBe(1)
  const call = service.control.runs.getRun(accepted.run.runId).calls![0]!
  await expect.poll(() => service.control.runs.getRun(call.runId).waits.length).toBe(1)
  await closeService(service)
  const reopened = await openService(file, { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  expect(reopened.control.runs.getRun(accepted.run.runId).status).toBe('indeterminate')
  expect(reopened.control.runs.getRun(call.runId).status).toBe('indeterminate')
  expect(reopened.control.runs.getRun(accepted.run.runId).calls).toHaveLength(1)
})

it('requires explicit refresh after any new Live revision and preserves input mappings', async () => {
  const service = await openService(':memory:', { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  const child = await target(service)
  const parent = await caller(service, child.flowId)
  const updated = await service.control.changeDraft('operator', child.flowId, child.revisionId, [
    {
      kind: 'flow.output-mappings.set',
      before: { answer: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'start', output: 'answer' }] } },
      value: { answer: { kind: 'value', value: 7 } },
    },
  ])
  expect((await service.control.checkFlow(parent.flowId, parent.revisionId, engine)).valid).toBe(true)
  const live = service.control.getFlow(child.flowId).live!
  const published = await service.control.publishFlow('operator', child.flowId, updated.revision.revisionId, engine, live.publicationId, 'compatible')
  await expect.poll(() => service.control.getPublishOperation(child.flowId, published.operationId).status).toBe('succeeded')
  expect(await service.control.checkFlow(parent.flowId, parent.revisionId, engine)).toMatchObject({
    valid: false,
    diagnostics: [{ code: 'workflow.revision-stale', path: '/document/graph/nodes/call/task/executor/revisionId' }],
  })
  expect(await service.control.checkAuthoring(parent.flowId, parent.revisionId)).toMatchObject({
    valid: false,
    diagnostics: [{ code: 'workflow.revision-stale', field: 'config.flowId' }],
  })
  await expect(service.control.runs.createDraftRun(parent.flowId, parent.revisionId, engine, {}, 'stale', { nodeId: 'start', outputs: {} })).rejects.toThrow(
    'Live revision has changed',
  )
  await expect(service.control.publishFlow('operator', parent.flowId, parent.revisionId, engine, null, 'stale-publish')).rejects.toThrow(
    'Live revision has changed',
  )
  const refreshed = await service.control.editAuthoring('operator', parent.flowId, {
    baseRevision: parent.revisionId,
    requestId: 'refresh',
    edits: [{ op: 'node.refresh', node: 'call' }],
  })
  expect(refreshed.validation.status).toBe('valid')
  const accepted = await service.control.runs.createDraftRun(parent.flowId, refreshed.revision, engine, {}, 'latest', { nodeId: 'start', outputs: {} })
  await expect.poll(() => service.control.runs.getRun(accepted.run.runId).status).toBe('completed')
  expect(service.run(accepted.run.runId)?.result).toMatchObject({ nodes: [{ outputs: { answer: 7 } }] })
  const broken = await service.control.changeDraft('operator', child.flowId, updated.revision.revisionId, [
    { kind: 'flow.output-defs.set', before: [number], value: [{ ...number, jsonSchema: { type: 'string' } }] },
    { kind: 'flow.output-mappings.set', before: { answer: { kind: 'value', value: 7 } }, value: { answer: { kind: 'value', value: 'changed' } } },
  ])
  const next = await service.control.publishFlow(
    'operator',
    child.flowId,
    broken.revision.revisionId,
    engine,
    service.control.getFlow(child.flowId).live!.publicationId,
    'breaking',
  )
  await expect.poll(() => service.control.getPublishOperation(child.flowId, next.operationId).status).toBe('succeeded')
  expect(await service.control.checkFlow(parent.flowId, refreshed.revision, engine)).toMatchObject({
    valid: false,
    diagnostics: [{ code: 'workflow.revision-stale', path: '/document/graph/nodes/call/task/executor/revisionId' }],
  })
})

it('supports nested calls with one slot and merges Draft and Live definition references', async () => {
  const service = await openService(':memory:', { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  const child = await target(service)
  const middle = await caller(service, child.flowId)
  const exposed = await service.control.changeDraft('operator', middle.flowId, middle.revisionId, [
    { kind: 'flow.input-defs.set', before: [], value: [number] },
    { kind: 'flow.output-defs.set', value: [number] },
    { kind: 'flow.output-mappings.set', value: { answer: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'call', output: 'answer' }] } } },
    { kind: 'graph.node.create', nodeId: 'outputs', node: { kind: 'outputs', name: 'Outputs' } },
    { kind: 'graph.edge.connect', edge: { source: 'call', target: 'outputs' } },
  ])
  const publication = await service.control.publishFlow('operator', middle.flowId, exposed.revision.revisionId, engine, null, 'middle')
  await expect.poll(() => service.control.getPublishOperation(middle.flowId, publication.operationId).status).toBe('succeeded')
  expect(service.control.getFlowReferences('operator', child.flowId, 'incoming', 0, 50)).toMatchObject({
    total: 1,
    references: [{ flowId: middle.flowId, draft: true, live: { enabled: true } }],
  })
  const outer = await caller(service, middle.flowId, undefined, 'Outer')
  const accepted = await service.control.runs.createDraftRun(outer.flowId, outer.revisionId, engine, {}, 'nested', { nodeId: 'start', outputs: {} })
  await expect.poll(() => service.control.runs.getRun(accepted.run.runId).status).toBe('completed')
  expect(service.run(accepted.run.runId)?.result).toMatchObject({ nodes: [{ outputs: { answer: 42 } }] })
  const middleRun = service.control.runs.getRun(accepted.run.runId).calls![0]!.runId
  expect(service.control.runs.getRun(middleRun).calls).toHaveLength(1)
})

it('rejects recursion during check and admission', async () => {
  const service = await openService(':memory:', { clock: Date.now })
  const child = await target(service)
  const parent = await caller(service, child.flowId)
  const original = service.control.getRevision(parent.flowId, parent.revisionId).content.document.graph.nodes.call!
  if (original.kind != 'task') throw new Error('Expected call')
  const recursive = await service.control.changeDraft('operator', parent.flowId, parent.revisionId, [
    {
      kind: 'graph.node.task.set',
      nodeId: 'call',
      before: original.task,
      value: { ...original.task, executor: { kind: 'workflow', flowId: parent.flowId, revisionId: parent.revisionId } },
    },
  ])
  expect(await service.control.checkFlow(parent.flowId, recursive.revision.revisionId, engine)).toMatchObject({
    valid: false,
    diagnostics: [{ message: 'Recursive workflow calls are not supported.' }],
  })
  await expect(
    service.control.runs.createDraftRun(parent.flowId, recursive.revision.revisionId, engine, {}, 'recursive', { nodeId: 'start', outputs: {} }),
  ).rejects.toThrow('Recursive')
})

it('creates separate child runs and matching event identities for each loop invocation', async () => {
  const service = await openService(':memory:', { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  const child = await target(service)
  const parent = await caller(service, child.flowId)
  const loop = await service.control.changeDraft('operator', parent.flowId, parent.revisionId, [
    {
      kind: 'module.create',
      moduleId: 'counter',
      module: { name: 'Counter', imports: [], source: 'export default ({previous}) => ({answer: (previous ?? 0) + 1})' },
    },
    {
      kind: 'graph.node.create',
      nodeId: 'counter',
      node: {
        kind: 'task',
        name: 'Counter',
        inputs: { previous: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'counter', output: 'answer' }] } },
        task: { name: 'Counter', moduleId: 'counter', inputs: [{ ...number, handle: 'previous', nullable: true }], outputs: [number] },
      },
    },
    {
      kind: 'graph.node.create',
      nodeId: 'choose',
      node: {
        kind: 'condition',
        name: 'Again',
        inputs: {},
        matchMode: 'first',
        cases: [
          {
            output: 'again',
            groups: [
              {
                expressions: [
                  { left: { kind: 'source', source: { kind: 'node', nodeId: 'call', output: 'answer' } }, operator: '<', right: { kind: 'value', value: 3 } },
                ],
              },
            ],
          },
        ],
      },
    },
    {
      kind: 'graph.node.input.set',
      nodeId: 'call',
      handle: 'answer',
      before: { kind: 'value', value: 42 },
      value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'counter', output: 'answer' }] },
    },
    { kind: 'graph.edge.disconnect', edge: { source: 'start', target: 'call' } },
    { kind: 'graph.edge.connect', edge: { source: 'start', target: 'counter' } },
    { kind: 'graph.edge.connect', edge: { source: 'counter', target: 'call' } },
    { kind: 'graph.edge.connect', edge: { source: 'call', target: 'choose' } },
    { kind: 'graph.edge.connect', edge: { source: 'choose', sourceHandle: 'again', target: 'counter' } },
  ])
  const accepted = await service.control.runs.createDraftRun(parent.flowId, loop.revision.revisionId, engine, {}, 'loop', { nodeId: 'start', outputs: {} })
  await expect.poll(() => service.control.runs.getRun(accepted.run.runId).status).toBe('completed')
  const calls = service.control.runs.getRun(accepted.run.runId).calls!
  expect(new Set(calls.map((call) => call.runId)).size).toBe(3)
  const completions = service.control.runs
    .getRunEvents(accepted.run.runId, 0, 100)
    .events.filter((event) => event.kind == 'node.completed')
    .filter((event) => event.payload.nodeId == 'call')
  expect(completions.map((event) => event.payload.outputs)).toEqual([{ answer: 1 }, { answer: 2 }, { answer: 3 }])
  expect(completions.map((event) => event.payload.executionId)).toEqual(calls.map((call) => call.executionId))
})

it('reports an unselected workflow separately without looking up an empty target', async () => {
  const service = await openService(':memory:')
  const parent = await create(service, 'Unconfigured', [
    { kind: 'graph.node.create', nodeId: 'start', node: { kind: 'start', name: 'Start' } },
    {
      kind: 'graph.node.create',
      nodeId: 'call',
      node: {
        kind: 'task',
        name: 'Call',
        inputs: {},
        task: { name: 'Call', inputs: [], outputs: [], executor: { kind: 'workflow', flowId: '', revisionId: '' } },
      },
    },
    { kind: 'graph.edge.connect', edge: { source: 'start', target: 'call' } },
  ])
  const store = (service.control as unknown as { store: Store }).store
  const lookup = vi.spyOn(store.flows, 'get')
  expect(await service.control.checkFlow(parent.flowId, parent.revisionId, engine)).toMatchObject({
    valid: false,
    diagnostics: [{ code: 'workflow.target-required', message: 'Select a target workflow.', path: '/document/graph/nodes/call/task/executor/flowId' }],
  })
  expect(lookup).not.toHaveBeenCalledWith('')
  expect(await service.control.checkAuthoring(parent.flowId, parent.revisionId)).toMatchObject({
    valid: false,
    diagnostics: [{ code: 'workflow.target-required', field: 'config.flowId' }],
  })
})

it('defers a missing Live Start to execution and uses Live rather than Draft', async () => {
  const service = await openService(':memory:')
  await startService(service)
  const created = await service.control.createFlow('operator', 'Legacy Live', 'legacy-live')
  const flowId = created.flow.flowId
  const published = await service.control.publishFlow('operator', flowId, created.flow.draftRevisionId, engine, null, 'empty-live')
  await expect.poll(() => service.control.getPublishOperation(flowId, published.operationId).status).toBe('succeeded')
  const draft = await service.control.changeDraft('operator', flowId, created.flow.draftRevisionId, [
    { kind: 'graph.node.create', nodeId: 'start', node: { kind: 'start', name: 'Start' } },
  ])
  const contract = service.control.getWorkflowContract('operator', flowId)
  expect(contract).toMatchObject({ flowId, revisionId: created.flow.draftRevisionId, inputs: [], outputs: [] })
  const parent = await create(service, 'Caller', [
    { kind: 'graph.node.create', nodeId: 'start', node: { kind: 'start', name: 'Start' } },
    { kind: 'graph.node.create', nodeId: 'call', node: { kind: 'task', name: 'Call', inputs: {}, task: workflowTask(contract) } },
    { kind: 'graph.edge.connect', edge: { source: 'start', target: 'call' } },
  ])
  expect((await service.control.checkFlow(parent.flowId, parent.revisionId, engine)).valid).toBe(true)
  const accepted = await service.control.runs.createDraftRun(parent.flowId, parent.revisionId, engine, {}, 'missing-start', { nodeId: 'start', outputs: {} })
  await expect.poll(() => service.control.runs.getRun(accepted.run.runId).status).toBe('failed')
  expect(service.control.runs.getRun(accepted.run.runId).calls).toEqual([])
  expect(service.run(accepted.run.runId)?.result).toMatchObject({ error: { message: 'Live Runs can only be started through a Start node.' } })
  const next = await service.control.publishFlow(
    'operator',
    flowId,
    draft.revision.revisionId,
    engine,
    service.control.getFlow(flowId).live!.publicationId,
    'with-start',
  )
  await expect.poll(() => service.control.getPublishOperation(flowId, next.operationId).status).toBe('succeeded')
  expect(service.control.getWorkflowContract('operator', flowId)).toMatchObject({ flowId, revisionId: draft.revision.revisionId })
})

it('saves an unpublished target through authoring and refreshes it after publication', async () => {
  const service = await openService(':memory:')
  await startService(service)
  const child = await service.control.createFlow('operator', 'Draft target', 'draft-target')
  const parent = await service.control.createFlow('operator', 'Caller', 'caller')
  const edited = await service.control.editAuthoring('operator', parent.flow.flowId, {
    baseRevision: parent.flow.draftRevisionId,
    requestId: 'select',
    edits: [{ op: 'node.add', as: 'call', name: 'Draft target', type: 'workflow', config: { flowId: child.flow.flowId } }],
  })
  expect(service.control.getRevision(parent.flow.flowId, edited.revision).content.document.graph.nodes).toMatchObject({
    [edited.nodes.call!]: { task: { executor: { flowId: child.flow.flowId, revisionId: '' } } },
  })
  expect(await service.control.checkAuthoring(parent.flow.flowId, edited.revision)).toMatchObject({
    valid: false,
    diagnostics: [{ code: 'workflow.unpublished' }],
  })
  const published = await service.control.publishFlow('operator', child.flow.flowId, child.flow.draftRevisionId, engine, null, 'publish-draft')
  await expect.poll(() => service.control.getPublishOperation(child.flow.flowId, published.operationId).status).toBe('succeeded')
  const refreshed = await service.control.editAuthoring('operator', parent.flow.flowId, {
    baseRevision: edited.revision,
    requestId: 'refresh',
    edits: [{ op: 'node.refresh', node: edited.nodes.call! }],
  })
  expect(refreshed.validation.status).toBe('valid')
})

it('diagnoses each caller of the same invalid dependency while reading each target revision once', async () => {
  const service = await openService(':memory:')
  const leaf = await target(service)
  const middle = await caller(service, leaf.flowId)
  const live = await service.control.publishFlow('operator', middle.flowId, middle.revisionId, engine, null, 'middle-live')
  await expect.poll(() => service.control.getPublishOperation(middle.flowId, live.operationId).status).toBe('succeeded')
  const task = workflowTask(service.control.getWorkflowContract('operator', middle.flowId))
  const outer = await create(service, 'Outer', [
    { kind: 'graph.node.create', nodeId: 'start', node: { kind: 'start', name: 'Start' } },
    { kind: 'graph.node.create', nodeId: 'first', node: { kind: 'task', name: 'First call', inputs: {}, task } },
    { kind: 'graph.node.create', nodeId: 'second', node: { kind: 'task', name: 'Second call', inputs: {}, task } },
    { kind: 'graph.edge.connect', edge: { source: 'start', target: 'first' } },
    { kind: 'graph.edge.connect', edge: { source: 'start', target: 'second' } },
  ])
  const changed = await service.control.changeDraft('operator', leaf.flowId, leaf.revisionId, [
    {
      kind: 'flow.output-mappings.set',
      before: { answer: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'start', output: 'answer' }] } },
      value: { answer: { kind: 'value', value: 7 } },
    },
  ])
  const updated = await service.control.publishFlow(
    'operator',
    leaf.flowId,
    changed.revision.revisionId,
    engine,
    service.control.getFlow(leaf.flowId).live!.publicationId,
    'leaf-updated',
  )
  await expect.poll(() => service.control.getPublishOperation(leaf.flowId, updated.operationId).status).toBe('succeeded')
  const store = (service.control as unknown as { store: Store }).store
  const read = vi.spyOn(store.flows, 'revision')
  const checked = await service.control.checkFlow(outer.flowId, outer.revisionId, engine)
  expect(checked.diagnostics).toMatchObject([
    { code: 'workflow.dependency-stale', path: '/document/graph/nodes/first/task/executor/flowId' },
    { code: 'workflow.dependency-stale', path: '/document/graph/nodes/second/task/executor/flowId' },
  ])
  expect(read.mock.calls.filter(([id]) => id == middle.flowId)).toHaveLength(1)
  expect(read.mock.calls.filter(([id]) => id == leaf.flowId)).toHaveLength(1)
  const childLive = service.control.getFlow(leaf.flowId).live!
  service.control.setFlowEnabled(leaf.flowId, childLive.publicationId, false)
  expect((await service.control.checkFlow(outer.flowId, outer.revisionId, engine)).diagnostics).toMatchObject([
    { code: 'workflow.dependency-invalid', path: '/document/graph/nodes/first/task/executor/flowId' },
    { code: 'workflow.dependency-invalid', path: '/document/graph/nodes/second/task/executor/flowId' },
  ])
})

it('protects unfinished child calls and retains origin until both runs are deleted', async () => {
  const service = await openService(':memory:', { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  const child = await target(service, true)
  const parent = await caller(service, child.flowId)
  const accepted = await service.control.runs.createDraftRun(parent.flowId, parent.revisionId, engine, {}, 'cleanup', { nodeId: 'start', outputs: {} })
  await expect.poll(() => service.control.runs.getRun(accepted.run.runId).calls?.length).toBe(1)
  const call = service.control.runs.getRun(accepted.run.runId).calls![0]!
  await expect.poll(() => service.control.runs.getRun(call.runId).waits.length).toBe(1)
  const store = (service.control as unknown as { store: Store }).store
  expect(store.runs.deleteByFlow(child.flowId, 10)).toBe(0)
  const wait = service.control.runs.getRun(call.runId).waits[0]!
  service.control.runs.resolveRunWait(call.runId, wait.waitId, 'continue')
  await expect.poll(() => service.control.runs.getRun(accepted.run.runId).status).toBe('completed')
  expect(store.runs.deleteByFlow(parent.flowId, 10)).toBe(1)
  expect(store.runs.workflowOrigin(call.runId)).toMatchObject({ runId: accepted.run.runId })
  expect(store.runs.deleteByFlow(child.flowId, 10)).toBe(1)
  expect(store.runs.workflowOrigin(call.runId)).toBeUndefined()
})

it('resolves authoring targets with one metadata lookup and no revision read for an unpublished target', async () => {
  const service = await openService(':memory:')
  const live = await target(service)
  const draft = await service.control.createFlow('operator', 'Draft', 'draft')
  const store = (service.control as unknown as { store: Store }).store
  const get = vi.spyOn(store.flows, 'get')
  const read = vi.spyOn(store.flows, 'revision')
  expect(workflowAuthoringTarget(store, 'operator', live.flowId)).toMatchObject({ revisionId: live.revisionId })
  expect(get).toHaveBeenCalledTimes(1)
  expect(read).toHaveBeenCalledTimes(1)
  get.mockClear()
  read.mockClear()
  expect(workflowAuthoringTarget(store, 'operator', draft.flow.flowId)).toMatchObject({ problem: 'unpublished' })
  expect(get).toHaveBeenCalledTimes(1)
  expect(read).not.toHaveBeenCalled()
})
