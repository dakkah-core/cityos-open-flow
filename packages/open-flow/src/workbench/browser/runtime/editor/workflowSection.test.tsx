import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { expect, it, vi } from 'vitest'
import { createI18n } from '../i18n.ts'
import { WorkbenchLinkContext } from '../linkContext.ts'
import { WorkflowSection, WorkflowInterfaceAlert } from './workflowSection.tsx'

const actions = { busy: false, error: undefined, pending: undefined, select: vi.fn(), recheck: vi.fn() }
it.each(['', 'target'])('reflects an unselected target without fetching on render (%s)', (flowId) => {
  const list = vi.fn()
  const markup = renderToStaticMarkup(
    <I18nProvider i18n={createI18n('zh-CN')}>
      <WorkflowSection
        task={{ name: '调用工作流', inputs: [], outputs: [], executor: { kind: 'workflow', flowId, revisionId: flowId ? 'r1' : '' } }}
        disabled={false}
        actions={actions}
        list={list}
      />
    </I18nProvider>,
  )
  if (!flowId) {
    expect(markup).toContain('aria-invalid="true"')
    expect(markup).toContain('aria-describedby=')
    expect(markup).toContain('请选择目标工作流。')
  } else expect(markup).not.toContain('aria-invalid="true"')
  expect(list).not.toHaveBeenCalled()
})

it('uses the host route for new-window links in both target and error headings', () => {
  const hrefFor = vi.fn(({ flowId }: { flowId?: string }) => `/flows/${flowId}/design`)
  const markup = renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <WorkbenchLinkContext.Provider value={hrefFor}>
        <WorkflowInterfaceAlert actions={actions} flowId="target" disabled={false} stale={false} message="Unpublished" />
        <WorkflowSection
          task={{ name: 'Target', inputs: [], outputs: [], executor: { kind: 'workflow', flowId: 'target', revisionId: '' } }}
          disabled={false}
          actions={actions}
          list={vi.fn()}
        />
      </WorkbenchLinkContext.Provider>
    </I18nProvider>,
  )
  const links = markup.match(/<a\b[^>]*>/g) ?? []
  expect(links).toHaveLength(2)
  for (const link of links) {
    expect(link).toContain('href="/flows/target/design"')
    expect(link).toContain('target="_blank"')
    expect(link).toContain('rel="noopener noreferrer"')
    expect(link).toContain('aria-label="Open workflow in a new window"')
  }
  expect(hrefFor).toHaveBeenCalledWith({ flowId: 'target', view: 'design' })
})
