import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

/** Inventory already-published upstream merges without changing the selected
 * installation candidate or pretending upstream source is a CityOS patch. */
export function customizationBaseline(root, manifest) {
  const git = (args) => execFileSync('git', ['--no-optional-locks', '-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim()
  const rows = manifest.integratedUpstreamHistory ?? []
  assert.ok(Array.isArray(rows), 'upstream_history_array_required')
  let commit = manifest.upstream.commit
  const seen = new Set()
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ['mergeCommit', 'selectedForInstallation', 'upstreamCommit'])
    assert.equal(row.selectedForInstallation, false, 'source_history_cannot_select_an_installation')
    assert.match(row.mergeCommit, /^[a-f0-9]{40}$/u)
    assert.match(row.upstreamCommit, /^[a-f0-9]{40}$/u)
    assert.ok(!seen.has(row.mergeCommit), 'duplicate_upstream_history')
    seen.add(row.mergeCommit)
    const parents = git(['rev-list', '--parents', '-n', '1', row.mergeCommit]).split(' ')
    assert.equal(parents.length, 3, 'ordinary_two_parent_upstream_merge_required')
    assert.equal(parents[2], row.upstreamCommit, 'recorded_upstream_must_be_the_actual_merge_parent')
    git(['merge-base', '--is-ancestor', row.mergeCommit, 'HEAD'])
    git(['merge-base', '--is-ancestor', commit, row.upstreamCommit])
    commit = row.upstreamCommit
  }
  return { commit, history: structuredClone(rows) }
}
