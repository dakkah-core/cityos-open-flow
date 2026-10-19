import { expect, it, vi } from 'vitest'
import { downloadFlowSvg } from '../../../../canvas/browser/graph/FlowCanvas/exportSvg.ts'
import { WorkbenchClient } from '../api.ts'
import { WorkbenchStore } from './workbenchStore.ts'

vi.mock('../../../../canvas/browser/graph/FlowCanvas/exportSvg.ts', () => ({ downloadFlowSvg: vi.fn() }))

it.each([true, false])('reports the SVG export result after completion (success=%s)', async (success) => {
  let finish!: () => void
  const pending = new Promise<void>((resolve, reject) => {
    finish = () => (success ? resolve() : reject(new Error('Export failed')))
  })
  vi.mocked(downloadFlowSvg).mockClear().mockReturnValueOnce(pending)
  const store = new WorkbenchStore(new WorkbenchClient(vi.fn()), { getItem: () => null, setItem: () => {} })
  try {
    const exporting = store.exportSvg('en', { dark: true })
    await vi.waitFor(() => expect(downloadFlowSvg).toHaveBeenCalledTimes(1))
    expect(store.$.notice.value).toBeUndefined()
    finish()
    await exporting
    expect(store.$.notice.value).toEqual(
      success ? { kind: 'success', message: 'SVG image exported.' } : { kind: 'error', message: 'Could not export the SVG image. Please try again.' },
    )
  } finally {
    store.dispose()
  }
})
