import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, createReadStream, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { captureSourceIdentity, verifyIntegration } from './integration.mjs'
import { assertImmutableLinuxImage } from './docker-image-contract.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const version = readFileSync(path.join(root, '.node-version'), 'utf8').trim().replace(/^v/u, '')
assert.equal(process.versions.node, version, 'Select the owning canonical Node runtime')
assert.equal(process.platform, 'linux', 'This qualifier builds a Linux-native artifact only')
const bun = process.env.OPEN_FLOW_BUN_EXECUTABLE
assert.ok(bun && path.isAbsolute(bun), 'Select the exact pinned Bun executable')
assert.equal(execFileSync(bun, ['--version'], { encoding: 'utf8' }).trim(), readFileSync(path.join(root, '.bun-version'), 'utf8').trim())
const docker = args => execFileSync('docker', args, { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
assert.equal(docker(['info', '--format', '{{.OSType}}']).trim(), 'linux')
const context = docker(['context', 'inspect', '--format', '{{(index .Endpoints "docker").Host}}']).trim()
assert.equal(context, 'unix:///var/run/docker.sock', 'The qualification uses only the runner-owned local Docker engine')
assert.deepEqual(verifyIntegration(root).errors, [])
const source = captureSourceIdentity(root)
assert.equal(source.dirty, false, 'Clean committed source is required')
mkdirSync(path.join(root, '.build/upstream'), { recursive: true })
const output = mkdtempSync(path.join(root, '.build/upstream/linux-image-'))
const checks = []
const shaFile = async file => {
  const hash = createHash('sha256')
  for await (const block of createReadStream(file)) hash.update(block)
  return hash.digest('hex')
}
async function execute(name, command, args, timeout) {
  const logPath = path.join(output, name + '.log'), fd = openSync(logPath, 'wx')
  let result
  try { result = spawnSync(command, args, { cwd: root, env: process.env, timeout, stdio: ['ignore', fd, fd] }) }
  finally { closeSync(fd) }
  const check = { name, exitCode: result.status, error: result.error?.code, signal: result.signal,
    logPath, logSha256: await shaFile(logPath) }
  checks.push(check)
  assert.equal(result.error, undefined, name + ' interrupted; inspect the recorded log')
  assert.equal(result.status, 0, name + ' failed; inspect ' + logPath)
}
try {
  const iid = path.join(output, 'image.id')
  await execute('build', 'docker', ['build', '--file', 'apps/server/Dockerfile', '--iidfile', iid,
    '--label', 'org.opencontainers.image.revision=' + source.sourceSha, '.'], 12 * 60 * 1000)
  const imageId = readFileSync(iid, 'utf8').trim()
  const image = assertImmutableLinuxImage(JSON.parse(docker(['image', 'inspect', imageId]))[0], imageId)
  assert.equal(image.Config?.Labels?.['org.opencontainers.image.revision'], source.sourceSha)
  assert.deepEqual(captureSourceIdentity(root), source)
  const journeyPath = path.join(output, 'journey.json')
  await execute('real-docker-journey', bun, ['apps/server/scripts/check-docker.ts', '--image', imageId, '--receipt', journeyPath], 5 * 60 * 1000)
  const journey = JSON.parse(readFileSync(journeyPath, 'utf8'))
  assert.equal(journey.success, true); assert.equal(journey.cleanupComplete, true)
  assert.equal(journey.skipped, 0); assert.equal(journey.failed, 0); assert.equal(journey.passed, 1)
  assert.equal(journey.image.id, imageId); assert.equal(journey.image.os, 'linux')
  assert.deepEqual(journey.source, source); assert.deepEqual(journey.after, source)
  const artifact = path.join(output, 'image.tar')
  await execute('save-tested-image', 'docker', ['image', 'save', '--output', artifact, imageId], 2 * 60 * 1000)
  assert.equal(JSON.parse(docker(['image', 'inspect', imageId]))[0].Id, imageId)
  assert.deepEqual(captureSourceIdentity(root), source)
  const receipt = { schemaVersion: 'cityos.open-flow-linux-image.v1', recordedAt: new Date().toISOString(), source,
    upstream: JSON.parse(readFileSync(path.join(root, 'config/upstream/integration.json'), 'utf8')).upstream,
    lockfileSha256: await shaFile(path.join(root, 'bun.lock')), node: process.versions.node,
    image: { id: imageId, os: image.Os, architecture: image.Architecture },
    artifact: { path: artifact, sha256: await shaFile(artifact), type: 'docker-image-save' },
    journey: { path: journeyPath, sha256: await shaFile(journeyPath) }, checks, success: true,
    publicPackedClientQualified: false, cmsInstallationQualified: false, registryPublicationQualified: false, activationQualified: false,
    nonClaims: ['The retained image archive contains the same immutable image that passed the actual Docker journey.',
      'A local image ID is distinct from a published registry manifest digest. CMS authoring-scope qualification and activation remain required.'] }
  writeFileSync(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output, imageId, artifactSha256: receipt.artifact.sha256, success: true }))
} catch (error) {
  writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ source, checks, success: false,
    error: String(error.message).slice(0, 2000), imageQualified: false, cmsInstallationQualified: false, activationQualified: false }, null, 2) + '\n', { flag: 'wx' })
  throw error
}
