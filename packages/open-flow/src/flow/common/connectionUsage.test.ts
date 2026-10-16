import type { RevisionContent } from './change.ts'

import { expect, it } from 'vitest'
import { applyFlowChanges, currentFlowModelVersion } from './change.ts'
import { connectionUsage } from './connectionUsage.ts'
import { inverseFlowChanges } from './inverseChanges.ts'
import { setServiceConnections } from './nodeChanges.ts'
import { flowResourceReferences } from './semantics.ts'
import { encodeWorkflowFile, parseWorkflowFile } from './workflowFile.ts'

it('fills only the selected service’s missing accounts across node types, preserving definitions and undo', () => {
  const content: RevisionContent = {
    modelVersion: currentFlowModelVersion,
    modules: { shared: { name: 'Shared', source: 'export default () => ({})', imports: [] } },
    document: {
      bindings: {},
      graph: {
        edges: [],
        nodes: {
          connector: { kind: 'task', inputs: {}, task: { name: 'Send', inputs: [], outputs: [], executor: { kind: 'connector', action: 'mail.send' } } },
          code: {
            kind: 'task',
            inputs: {},
            task: {
              name: 'Code',
              moduleId: 'shared',
              inputs: [],
              outputs: [],
              capabilities: [
                {
                  kind: 'connector',
                  mode: 'independent',
                  actions: [{ action: 'mail.send' }, { action: 'mail.read', connectionId: 'personal' }, { action: 'github.create_issue' }],
                },
              ],
            },
          },
          otherCode: { kind: 'task', inputs: {}, task: { name: 'Other', moduleId: 'shared', inputs: [], outputs: [] } },
          agent: {
            kind: 'task',
            inputs: {},
            task: {
              name: 'Agent',
              inputs: [],
              outputs: [],
              executor: {
                kind: 'agent',
                model: 'model',
                prompt: 'Keep prompt',
                maxRounds: 5,
                tools: [
                  { id: 'send', name: 'send', description: 'Send', approval: true, action: 'mail.send', inputs: [] },
                  { id: 'read', name: 'read', description: 'Read', approval: false, action: 'mail.read', connectionId: 'personal', inputs: [] },
                ],
                notification: {
                  action: 'mail.send',
                  inputDefinitions: [],
                  messageHandle: 'message',
                  inputs: { message: { kind: 'value', value: 'Keep message' } },
                },
              },
            },
          },
          trigger: {
            kind: 'poll',
            name: 'Inbox',
            config: { folder: { kind: 'value', value: 'Inbox' } },
            pollTimes: [],
            definition: {
              type: 'poll',
              provider: 'mail',
              key: 'mail.received',
              name: 'received',
              displayName: 'Inbox',
              description: '',
              definitionVersion: 2,
              configInputs: [],
              outputs: [],
            },
          },
        },
      },
    },
  }
  const deferred = applyFlowChanges(content, setServiceConnections(content, 'mail', ''))
  expect(
    connectionUsage(deferred.document)
      .filter((use) => use.connectionId === '')
      .map((use) => use.kind),
  ).toEqual(['connector', 'code', 'agent', 'notification'])
  expect(deferred.document.graph.nodes.trigger).toEqual(content.document.graph.nodes.trigger)
  expect(flowResourceReferences(deferred).connections).toEqual([{ providerId: 'mail', connectionId: 'personal' }])
  const exported = parseWorkflowFile(encodeWorkflowFile({ kind: 'open-flow-workflow', version: 1, content: deferred }))
  expect(connectionUsage(exported.content.document).filter((use) => use.connectionId === '')).toEqual(
    connectionUsage(deferred.document).filter((use) => use.connectionId === ''),
  )
  const cleared = applyFlowChanges(deferred, setServiceConnections(deferred, 'mail', undefined, ''))
  expect(cleared).toEqual(content)
  const reconnected = applyFlowChanges(deferred, setServiceConnections(deferred, 'mail', 'work', ''))
  expect(reconnected.document.graph.nodes.trigger).toEqual(content.document.graph.nodes.trigger)
  expect(connectionUsage(reconnected.document).filter((use) => use.connectionId === '')).toEqual([])
  const operations = setServiceConnections(content, 'mail', 'work')
  const after = applyFlowChanges(content, operations)
  expect(connectionUsage(after.document)).toEqual(
    connectionUsage(content.document).map((use) =>
      use.providerId == 'mail' && use.connectionId == null ? Object.assign({}, use, { connectionId: 'work' }) : use,
    ),
  )
  expect(after.modules).toEqual(content.modules)
  expect(after.document.graph.nodes.otherCode).toEqual(content.document.graph.nodes.otherCode)
  expect(after.document.graph.nodes.agent).toMatchObject({
    task: {
      executor: {
        prompt: 'Keep prompt',
        tools: [{ approval: true }, { connectionId: 'personal' }],
        notification: { inputs: { message: { kind: 'value', value: 'Keep message' } } },
      },
    },
  })
  expect(after.document.graph.nodes.trigger).toMatchObject({ config: { folder: { kind: 'value', value: 'Inbox' } } })
  expect(setServiceConnections(after, 'mail', 'different')).toEqual([])
  expect(setServiceConnections(content, 'unrelated', 'work')).toEqual([])
  const restored = applyFlowChanges(after, inverseFlowChanges(content, operations))
  expect(restored).toEqual(content)
  expect(applyFlowChanges(restored, operations)).toEqual(after)
})
