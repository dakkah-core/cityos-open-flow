import type { RevisionContent } from '../../src/flow/common/change.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { I18nProvider } from 'val-i18n-react'
import { FlowCanvasView } from '../../src/canvas/browser/graph/FlowCanvas/FlowCanvasView.tsx'
import { currentFlowModelVersion } from '../../src/flow/common/change.ts'
import { NodeInspector } from '../../src/workbench/browser/runtime/editor/nodeInspector.tsx'
import { designerGraph } from '../../src/workbench/browser/runtime/workspace.ts'
import { InspectorSamplePanel } from './inspectorSamplePanel.tsx'
import { createInspectorSession } from './inspectorSession.ts'
import { useStoryActions } from './storyActions.tsx'

const content: RevisionContent = {
  modelVersion: currentFlowModelVersion,
  modules: {},
  document: {
    bindings: {},
    inputDefs: [{ handle: 'message', jsonSchema: { type: 'string' }, nullable: false }],
    outputDefs: [
      { handle: 'message', jsonSchema: { type: 'string' }, nullable: false },
      { handle: 'count', jsonSchema: { type: 'number' }, nullable: false },
      { handle: 'note', jsonSchema: { type: 'string' }, nullable: true },
      { handle: 'missing', jsonSchema: { type: 'string' }, nullable: false },
    ],
    outputMappings: {
      message: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'start', output: 'message' }] },
      count: { kind: 'value', value: 42 },
      note: { kind: 'value', value: null },
      missing: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'start', output: 'removed' }] },
    },
    graph: {
      nodes: { start: { kind: 'start', name: 'Start' }, outputs: { kind: 'outputs' } },
      edges: [{ source: 'start', target: 'outputs' }],
    },
  },
}

function OutputsStory({ log, dark, language }: { log: LogAction; dark: boolean; language: UiLanguage }) {
  const [session, setSession] = useState<ReturnType<typeof createInspectorSession>>()
  const [generation, reset] = useState(0)
  const logRef = useRef(log)
  logRef.current = log
  useEffect(() => {
    const next = createInspectorSession(language, (name, value) => logRef.current(name, value), content)
    setSession(next)
    void next.start().then(() => next.store.selectNodes(['outputs']))
    return () => next.dispose()
  }, [language, generation])
  const revision = useVal(session?.store.$.revision)
  const presentation = useVal(session?.store.$.presentation)
  const selected = useVal(session?.store.$.selectedNodeIds) ?? []
  const history = useVal(session?.store.history$)
  useStoryActions([
    { label: 'Undo', disabled: !history?.canUndo, onClick: () => void session?.store.undo() },
    { label: 'Redo', disabled: !history?.canRedo, onClick: () => void session?.store.redo() },
    { label: 'Empty outputs', onClick: () => void session?.store.saveFlowOutputDefs('outputs', []) },
    { label: 'Reload saved data', onClick: () => void session?.start().then(() => session.store.selectNodes(['outputs'])) },
    { label: 'Reset samples', onClick: () => reset((value) => value + 1) },
  ])
  if (session == null || revision == null) return null
  const selection = revision.selection(selected[0] ?? 'outputs')
  return (
    <I18nProvider i18n={session.i18n}>
      <div className="open-flow-workbench open-flow-theme grid h-full min-h-0 grid-cols-[minmax(0,1fr)_380px] gap-3" data-theme={dark ? 'dark' : 'light'}>
        <FlowCanvasView
          identity="outputs-lab"
          model={designerGraph(revision.revision, presentation?.value, [], {}, {}, session.i18n.t)}
          editable
          dark={dark}
          language={language}
          fitView
          ignoredNodeIds={[]}
          selectedNodeIds={selected}
          onSelectionChange={(ids) => session.store.selectNodes(ids)}
          onMoveNodes={(positions) => void session.store.moveNodes(positions)}
          onMoveViewport={(viewport) => void session.store.moveViewport(viewport)}
          onConnect={(edge) => void session.store.connect(edge)}
        />
        <div className="min-h-0 overflow-auto">
          <InspectorSamplePanel disabled={false} revision={revision} selection={selection} store={session.store} theme={dark ? 'dark' : 'light'}>
            <NodeInspector
              revision={revision}
              selection={selection}
              store={session.store}
              connectors={session.connectors}
              triggers={session.triggers}
              variables={{ enabled: false, loaded: false, loading: false, names: [] }}
              theme={dark ? 'dark' : 'light'}
            />
          </InspectorSamplePanel>
        </div>
      </div>
    </I18nProvider>
  )
}

export const outputsStory: FrontendStory = {
  id: 'node-outputs',
  group: 'Node Outputs',
  title: 'Workflow Outputs',
  standalone: true,
  description:
    'Workflow output definitions and mappings share production editing and history. Select Start or Workflow Outputs to verify that their node menus omit Clone. Compare constants, upstream sources, nullable fields, missing sources and empty outputs; undo, redo and reload preserve saved configuration.',
  render: (log, dark, language) => <OutputsStory log={log} dark={dark} language={language} />,
}
