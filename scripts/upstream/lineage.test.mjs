import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { customizationBaseline } from './lineage.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const selected = '0103070aea74d007660844d965b446664fc6eb52'
const observed = {
  mergeCommit: '15646debbf2daa8c0a1a51b54eef858ef0d33c2f',
  upstreamCommit: 'c662e5088948603e1a71489b9a49b4e9039599c8',
  selectedForInstallation: false,
}
test('actual published ancestry explains upstream source without changing the selected candidate', () => {
  const manifest = { upstream: { commit: selected }, integratedUpstreamHistory: [observed] }
  assert.equal(customizationBaseline(root, manifest).commit, observed.upstreamCommit)
  assert.equal(manifest.upstream.commit, selected)
  assert.equal(customizationBaseline(root, { upstream: { commit: selected } }).commit, selected)
  assert.equal(JSON.parse(readFileSync(new URL('../../config/upstream/integration.json', import.meta.url))).upstream.commit, selected)
})
test('foreign merge parents, unsupported selection, duplicates and undeclared history fields are refused', () => {
  for (const history of [
    [{ ...observed, upstreamCommit: selected }],
    [{ ...observed, mergeCommit: selected }],
    [{ ...observed, selectedForInstallation: true }],
    [{ ...observed, bypass: true }],
    [observed, observed],
  ])
    assert.throws(() => customizationBaseline(root, { upstream: { commit: selected }, integratedUpstreamHistory: history }))
})
