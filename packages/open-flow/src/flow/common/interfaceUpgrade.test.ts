import { expect, it } from 'vitest'
import { decodeFlowDocument, upgradeWorkflowInterfaceDocument } from './encoding.ts'

const port = { handle: 'message', jsonSchema: { type: 'string' }, nullable: false }

it('explicitly moves legacy Start parameters and Outputs mappings while preserving references and rejecting normal old-format reads', () => {
  const source = {
    inputDefs: [port],
    outputDefs: [port],
    outputMappings: { message: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'start', output: 'message' }] } },
    bindings: {},
    graph: {
      nodes: { start: { kind: 'start', name: 'Start', parameters: [port] }, outputs: { kind: 'outputs', name: 'Outputs' } },
      edges: [{ source: 'start', target: 'outputs' }],
    },
  }
  const before = structuredClone(source)
  expect(() => decodeFlowDocument(source)).toThrow()
  const upgraded = decodeFlowDocument(upgradeWorkflowInterfaceDocument(source))
  expect(upgraded).toEqual({
    bindings: {},
    graph: {
      nodes: {
        start: { kind: 'start', name: 'Start', inputDefs: [port] },
        outputs: { kind: 'outputs', name: 'Outputs', outputDefs: [port], outputMappings: source.outputMappings },
      },
      edges: source.graph.edges,
    },
  })
  expect(upgradeWorkflowInterfaceDocument(upgraded)).toEqual(upgraded)
  expect(source).toEqual(before)
})

it('preserves absent nodes and initializes present nodes with empty configuration', () => {
  expect(upgradeWorkflowInterfaceDocument({ inputDefs: [], outputDefs: [], outputMappings: {}, bindings: {}, graph: { nodes: {}, edges: [] } })).toEqual({
    bindings: {},
    graph: { nodes: {}, edges: [] },
  })
  expect(
    upgradeWorkflowInterfaceDocument({ bindings: {}, graph: { nodes: { start: { kind: 'start', name: 'Start' }, outputs: { kind: 'outputs' } }, edges: [] } }),
  ).toMatchObject({ graph: { nodes: { start: { inputDefs: [] }, outputs: { outputDefs: [], outputMappings: {} } } } })
})

it.each([
  { inputDefs: [port], graph: { nodes: {} } },
  { outputDefs: [port], graph: { nodes: {} } },
  { outputMappings: { message: { kind: 'value', value: 'retained' } }, graph: { nodes: {} } },
  { inputDefs: [port], graph: { nodes: { start: { kind: 'start', parameters: [] } } } },
  { inputDefs: null, graph: { nodes: { start: { kind: 'start' } } } },
  { graph: { nodes: { start: { kind: 'start' }, duplicate: { kind: 'start' } } } },
])('refuses ambiguous or invalid legacy configuration instead of dropping it: %j', (source) => {
  expect(() => upgradeWorkflowInterfaceDocument(source)).toThrow()
})

it('leaves unrelated unsupported content for its existing repair path and does not repair invalid graphs while moving interfaces', () => {
  const unsupported = { graph: null, tasks: { old: {} } }
  expect(upgradeWorkflowInterfaceDocument(unsupported)).toBe(unsupported)
  expect(() => upgradeWorkflowInterfaceDocument({ ...unsupported, inputDefs: [] })).toThrow('invalid workflow graph')
})
