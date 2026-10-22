import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))

test('the real server dependency graph bundles for Node without borrowing optional peers from another workspace', () => {
  assert.equal(process.versions.node, readFileSync(path.join(root, '.node-version'), 'utf8').trim().replace(/^v/, ''))
  const bun = process.env.OPEN_FLOW_BUN_EXECUTABLE ?? 'bun'
  const version = spawnSync(bun, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 30000 })
  assert.equal(version.status, 0)
  assert.equal(version.stdout.trim(), readFileSync(path.join(root, '.bun-version'), 'utf8').trim())
  const parent = path.join(root, '.build/upstream')
  mkdirSync(parent, { recursive: true })
  const output = mkdtempSync(path.join(parent, 'server-runtime-bundle-'))
  const result = spawnSync(bun, ['build', 'node/main.ts', 'node/runtime/isolated-vm.ts', 'node/runtime/isolated-vm-executor.ts',
    '--target=node', '--splitting', '--packages=bundle', '--external=isolated-vm', '--entry-naming=[name].[ext]', '--outdir=' + path.join(output, 'server')], {
    cwd: path.join(root, 'apps/server'), encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 16 * 1024 * 1024,
  })
  const log = (result.stdout ?? '') + (result.stderr ?? '')
  writeFileSync(path.join(output, 'bundle.log'), log)
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, `Actual server bundle failed: ${log}`)
  assert.ok(readFileSync(path.join(output, 'server/main.js')).length > 100)
})
