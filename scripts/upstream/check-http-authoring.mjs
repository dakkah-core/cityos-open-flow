import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { captureSourceIdentity } from './integration.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const nodeVersion = readFileSync(path.join(root, '.node-version'), 'utf8').trim().replace(/^v/, '')
assert.equal(process.versions.node, nodeVersion, 'Select the owning canonical Node runtime')
const sourceManifest = JSON.parse(readFileSync(path.join(root, 'packages/open-flow/package.json'), 'utf8'))
const archive = path.resolve(process.argv[2] ?? path.join(root, 'packages/open-flow/dist/release', `oomol-lab-open-flow-${sourceManifest.version}.tgz`))
const artifactBytes = readFileSync(archive)
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const packageRequire = createRequire(path.join(root, 'packages/open-flow/package.json'))
const serverRequire = createRequire(path.join(root, 'apps/server/package.json'))
const { unpackTar } = await import(pathToFileURL(packageRequire.resolve('modern-tar')).href)
const entries = await unpackTar(gunzipSync(artifactBytes), { strict: true })
const manifestEntry = entries.find((entry) => entry.header.name === 'package/package.json')
assert.ok(manifestEntry?.data, 'Packed package manifest is required')
const manifest = JSON.parse(new TextDecoder().decode(manifestEntry.data))
assert.equal(manifest.name, '@oomol-lab/open-flow')
assert.equal(manifest.version, sourceManifest.version)
const workspace = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const parent = path.join(root, '.build/upstream')
mkdirSync(parent, { recursive: true })
const output = mkdtempSync(path.join(parent, 'http-authoring-'))
const consumer = path.join(output, 'consumer')
mkdirSync(consumer)
const dependencies = { '@oomol-lab/open-flow': `file:${archive}` }
for (const [name, version] of Object.entries(manifest.peerDependencies)) {
  assert.equal(version, workspace.catalog[name], `Packed peer must match the owning catalog: ${name}`)
  dependencies[name] = version
}
writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies }, null, 2) + '\n')
const bun = process.env.OPEN_FLOW_BUN_EXECUTABLE
assert.ok(bun, 'OPEN_FLOW_BUN_EXECUTABLE must select the owning pinned Bun executable')
const bunVersion = readFileSync(path.join(root, '.bun-version'), 'utf8').trim()
assert.equal(execFileSync(bun, ['--version'], { encoding: 'utf8', windowsHide: true }).trim(), bunVersion)
writeFileSync(
  path.join(output, 'install.log'),
  execFileSync(bun, ['install', '--ignore-scripts'], { cwd: consumer, encoding: 'utf8', windowsHide: true, timeout: 120000 }),
)
const probe = path.join(consumer, 'public-consumer.mjs')
writeFileSync(
  probe,
  "export { controlApiConformanceCases } from '@oomol-lab/open-flow/control-api-conformance';\nexport { ControlClient } from '@oomol-lab/open-flow/control-api';\n",
)
const conformance = await import(pathToFileURL(probe).href)
const { ControlClient } = conformance
const { ServerService } = await import('../../apps/server/node/application/service.ts')
const { Database } = await import('../../apps/server/node/storage/database.ts')
const { createServerApp } = await import('../../apps/server/node/transport/http.ts')
const { serve } = await import(pathToFileURL(serverRequire.resolve('@hono/node-server')).href)
const Effect = await import(pathToFileURL(serverRequire.resolve('effect/Effect')).href)
const Scope = await import(pathToFileURL(serverRequire.resolve('effect/Scope')).href)
const Exit = await import(pathToFileURL(serverRequire.resolve('effect/Exit')).href)
const source = captureSourceIdentity(root)
assert.equal(source.dirty, false, 'HTTP qualification requires clean committed source')
const selected = [
  'deduplicates simultaneous creation and lost-response retries',
  'commits one concurrent Draft change and replays the winning key',
  'creates, replays, lists, reads, renames, and retires a Flow',
  'commits immutable Draft Revisions for one Flow',
  'repairs a Draft with immutable history, idempotency and Revision CAS',
  'loads the current editor without changing Draft or Presentation',
  'keeps Presentation CAS independent from the Draft head',
]
const results = []
let requests = 0
for (const name of selected) {
  const matches = conformance.controlApiConformanceCases.filter((item) => item.name === name)
  assert.equal(matches.length, 1, `Required packed conformance case is missing or ambiguous: ${name}`)
  assert.notEqual(matches[0].runtime, true, 'Authoring qualification must not execute flows')
  const directory = path.join(output, `case-${results.length}`)
  mkdirSync(directory)
  const database = Database.open(path.join(directory, 'authoring.sqlite'))
  const scope = await Effect.runPromise(Scope.make())
  let server
  try {
    const service = await Effect.runPromise(ServerService.open(database).pipe(Scope.provide(scope)))
    let token = randomBytes(32).toString('hex')
    const app = createServerApp(service, {
      resolveControlActor: (request) => (request.headers.get('authorization') === `Bearer ${token}` ? 'operator' : undefined),
    })
    server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    if (!server.listening)
      await new Promise((resolve, reject) => {
        server.once('listening', resolve)
        server.once('error', reject)
      })
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const origin = `http://127.0.0.1:${address.port}`
    const request = async (input) => {
      assert.equal(new URL(input.url).origin, origin, 'Conformance must stay on the owned loopback listener')
      requests++
      const headers = new Headers(input.headers)
      headers.set('authorization', `Bearer ${token}`)
      return fetch(new Request(input, { headers, signal: AbortSignal.timeout(15000), redirect: 'error' }))
    }
    const harness = { origin, request, dispose: async () => {} }
    assert.equal((await fetch(`${origin}/v1/flows`, { signal: AbortSignal.timeout(15000) })).status, 401)
    await matches[0].verify(harness)
    const api = new ControlClient((route, init) => request(new Request(new URL(route, origin), init)))
    await api.listFlows({ limit: 10 })
    const oldToken = token
    token = randomBytes(32).toString('hex')
    assert.equal((await fetch(`${origin}/v1/flows`, { headers: { authorization: `Bearer ${oldToken}` }, signal: AbortSignal.timeout(15000) })).status, 401)
    await api.listFlows({ limit: 10 })
    results.push({ name, passed: true })
    console.log(`PASS ${name}`)
  } catch (error) {
    results.push({ name, passed: false })
    writeFileSync(path.join(output, 'failed-cases.json'), JSON.stringify({ source, results, requests, success: false }, null, 2) + '\n')
    throw error
  } finally {
    if (server) {
      server.closeAllConnections()
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
    try {
      await Effect.runPromise(Scope.close(scope, Exit.void))
    } finally {
      database.close()
    }
  }
}
const finalSource = captureSourceIdentity(root)
assert.deepEqual(finalSource, source, 'Source must remain unchanged throughout HTTP conformance')
const receipt = {
  schemaVersion: 'cityos.open-flow-http-authoring-check.v1',
  observedAt: new Date().toISOString(),
  source,
  artifact: { path: archive, sha256: sha(artifactBytes), packageVersion: manifest.version },
  lockfile: { path: 'bun.lock', sha256: sha(readFileSync(path.join(root, 'bun.lock'))) },
  node: process.versions.node,
  bun: bunVersion,
  results,
  requests,
  success: results.length === selected.length && results.every((item) => item.passed),
  cmsInstallationQualified: false,
  activationQualified: false,
  nonClaims: [
    'The packed public client uses real loopback HTTP and disposable migrated SQLite with the current source server.',
    'This does not qualify a server image, the CMS engine/v5 installation, tenant bindings or runtime activation.',
  ],
}
writeFileSync(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
console.log(JSON.stringify({ output, success: receipt.success, passed: results.length, requests }))
