import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, openSync, closeSync, mkdirSync, mkdtempSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { captureSourceIdentity, verifyIntegration } from './integration.mjs'
import { qualifyServerArtifact } from './qualify-server-artifact.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')

/** A successful startup is not evidence that these sources built the payload. */
export function assertServerBuildEvidence({ before, after, build, runtime, artifactSha256 }) {
  assert.match(before.sourceSha, /^[a-f0-9]{40}$/u)
  assert.match(before.sourceDigest, /^[a-f0-9]{64}$/u)
  assert.equal(typeof before.dirty, 'boolean')
  assert.match(artifactSha256, /^[a-f0-9]{64}$/u)
  assert.deepEqual(after, before, 'Server source changed between build and artifact qualification')
  assert.equal(build.exitCode, 0, 'The actual server build must finish successfully')
  assert.match(build.logSha256, /^[a-f0-9]{64}$/u)
  assert.equal(runtime.success, true)
  assert.equal(runtime.artifactStartupQualified, true)
  assert.equal(runtime.ownedRuntimeJoined, true, 'The qualified runtime must be joined before handback')
  assert.deepEqual(runtime.source, before, 'The extracted runtime must qualify the source that was built')
  assert.equal(runtime.artifact.sha256, artifactSha256, 'The tested archive bytes must remain unchanged')
  assert.deepEqual(runtime.checks.map(check => [check.name, check.status, check.expected]), [
    ['health', 200, 200], ['unauthenticated-control', 401, 401], ['authenticated-authoring-read', 200, 200],
  ])
}

/** Build once, then pack and exercise those same bytes through the real runtime. */
export async function qualifyServerBuild(cmsRoot, bun) {
  cmsRoot = path.resolve(cmsRoot)
  const catalog = JSON.parse(readFileSync(path.join(cmsRoot, 'config/toolchains/node-typescript.json')))
  assert.equal(process.versions.node, catalog.node)
  assert.equal(process.versions.node, readFileSync(path.join(root, '.node-version'), 'utf8').trim().replace(/^v/, ''))
  assert.ok(typeof bun === 'string' && path.isAbsolute(bun), 'Select the exact owning Bun executable')
  assert.equal(execFileSync(bun, ['--version'], { encoding: 'utf8', windowsHide: true }).trim(), readFileSync(path.join(root, '.bun-version'), 'utf8').trim())
  const require = createRequire(path.join(cmsRoot, 'package.json'))
  const { captureInstallLeaseForChild } = require('./scripts/toolchains/install-lease-process.cjs')
  const { acquireWorkspaceValidationLease } = await import(pathToFileURL(path.join(cmsRoot, 'scripts/toolchains/workspace-validation-lease.mjs')).href)
  const release = acquireWorkspaceValidationLease({ timeoutMs: 1000 })
  const parent = path.join(root, '.build/upstream'); mkdirSync(parent, { recursive: true })
  const output = mkdtempSync(path.join(parent, 'server-build-'))
  let source, build, runtime, receipt
  try {
    assert.deepEqual(verifyIntegration(root).errors, [], 'Declared upstream boundaries must pass')
    source = captureSourceIdentity(root)
    const lockfileSha256 = sha(readFileSync(path.join(root, 'bun.lock')))
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['systemroot', 'windir', 'path', 'pathext', 'comspec', 'temp', 'tmp', 'home', 'userprofile', 'appdata', 'localappdata'].includes(key.toLowerCase())))
    Object.assign(env, captureInstallLeaseForChild())
    const logPath = path.join(output, 'build.log'), fd = openSync(logPath, 'wx')
    const startedAt = new Date().toISOString()
    let result
    try {
      result = await new Promise(resolve => {
        const child = spawn(bun, ['scripts/build.ts'], { cwd: path.join(root, 'apps/server'), env, windowsHide: true, stdio: ['ignore', fd, fd] })
        let spawnError
        child.once('error', error => { spawnError = error.code })
        child.once('close', (exitCode, signal) => resolve({ exitCode, signal, error: spawnError }))
      })
    } finally { closeSync(fd) }
    build = { argv: [bun, 'scripts/build.ts'], startedAt, finishedAt: new Date().toISOString(), ...result, logPath, logSha256: sha(readFileSync(logPath)) }
    assert.equal(build.error, undefined); assert.equal(build.exitCode, 0, 'Server build failed: ' + logPath)
    assert.deepEqual(captureSourceIdentity(root), source)
    runtime = await qualifyServerArtifact(cmsRoot)
    assert.equal(runtime.receipt.success, true, 'Extracted runtime qualification failed: ' + runtime.output)
    assertServerBuildEvidence({ before: source, after: captureSourceIdentity(root), build, runtime: runtime.receipt,
      artifactSha256: sha(readFileSync(runtime.receipt.artifact.path)) })
    assert.equal(sha(readFileSync(path.join(root, 'bun.lock'))), lockfileSha256)
    receipt = { schemaVersion: 'cityos.open-flow-server-build.v1', success: true, source, lockfileSha256, build,
      artifact: runtime.receipt.artifact, runtimeReceipt: { path: path.join(runtime.output, 'receipt.json'), sha256: sha(readFileSync(path.join(runtime.output, 'receipt.json'))) },
      localSourceBuildQualified: true, artifactBuildProvenanceQualified: source.dirty === false,
      distributionQualified: false, cmsInstallationQualified: false, imageQualified: false, activationQualified: false,
      nonClaims: ['The real build and extracted runtime qualify the same frozen payload. Dirty inputs do not qualify a distribution commit.',
        'CityOS installation, container image, publication and environment activation require their own qualification.'] }
  } catch (error) {
    receipt = { schemaVersion: 'cityos.open-flow-server-build.v1', success: false, source, build,
      runtimeReceipt: runtime?.output, error: String(error.message).slice(0, 2048), localSourceBuildQualified: false,
      artifactBuildProvenanceQualified: false, distributionQualified: false, cmsInstallationQualified: false, imageQualified: false, activationQualified: false }
  } finally {
    try { writeFileSync(path.join(output, 'receipt.json'), JSON.stringify({ ...receipt, observedAt: new Date().toISOString() }, null, 2) + '\n') }
    finally { release() }
  }
  return { output, receipt }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 4, 'Usage: qualify-server-build.mjs <CMS workspace> <exact Bun executable>')
  const { output, receipt } = await qualifyServerBuild(...process.argv.slice(2))
  console.log(JSON.stringify({ output, success: receipt.success, artifact: receipt.artifact, error: receipt.error }))
  process.exitCode = receipt.success ? 0 : 1
}
