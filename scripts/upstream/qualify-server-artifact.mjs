import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { captureSourceIdentity } from './integration.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function payloadFiles(directory, relative = '') {
  return readdirSync(path.join(directory, relative), { withFileTypes: true })
    .flatMap((entry) => {
      const ref = path.join(relative, entry.name)
      assert.ok(entry.isFile() || entry.isDirectory(), 'Standalone runtime payload must not borrow linked files')
      return entry.isDirectory() ? payloadFiles(directory, ref) : [{ ref: ref.replaceAll('\\', '/'), sha256: sha(readFileSync(path.join(directory, ref))) }]
    })
    .sort((a, b) => a.ref.localeCompare(b.ref))
}

/** Qualify already-built, frozen bytes. This never builds, installs or publishes. */
export async function qualifyServerArtifact(cmsRoot) {
  cmsRoot = path.resolve(cmsRoot)
  const catalog = JSON.parse(readFileSync(path.join(cmsRoot, 'config/toolchains/node-typescript.json')))
  assert.equal(process.versions.node, catalog.node)
  assert.equal(process.versions.node, readFileSync(path.join(root, '.node-version'), 'utf8').trim().replace(/^v/, ''))
  const { acquireWorkspaceValidationLease } = await import(pathToFileURL(path.join(cmsRoot, 'scripts/toolchains/workspace-validation-lease.mjs')).href)
  const release = acquireWorkspaceValidationLease({ timeoutMs: 55000 })
  const require = createRequire(path.join(cmsRoot, 'package.json'))
  const parent = path.join(root, '.build/upstream')
  mkdirSync(parent, { recursive: true })
  const output = mkdtempSync(path.join(parent, 'server-artifact-'))
  let child,
    exited,
    source,
    artifact,
    files,
    token = '',
    stdout = '',
    stderr = '',
    receipt
  const redact = (value) => (token ? value.replaceAll(token, '[redacted]') : value)
  try {
    source = captureSourceIdentity(root)
    const dist = path.join(root, 'apps/server/dist')
    files = payloadFiles(dist)
    assert.ok(files.some((file) => file.ref === 'server/main.js'))
    assert.ok(
      files.some((file) => file.ref.endsWith('.node')),
      'The real native dependency must be present',
    )
    const archive = path.join(output, 'server.tgz')
    await require('tar').c({ cwd: dist, file: archive, portable: true, noMtime: true, gzip: true }, ['.'])
    artifact = { path: archive, sha256: sha(readFileSync(archive)), bytes: readFileSync(archive).length }
    const installed = path.join(output, 'runtime')
    mkdirSync(installed)
    await require('tar').x({
      file: archive,
      cwd: installed,
      strict: true,
      preservePaths: false,
      filter(ref, entry) {
        assert.ok(
          !path.isAbsolute(ref) &&
            !ref.includes(':') &&
            !ref.includes('\\') &&
            !ref.split('/').includes('..') &&
            ['File', 'OldFile', 'Directory'].includes(entry.type),
          'Unsafe server artifact entry',
        )
        return true
      },
    })
    assert.deepEqual(payloadFiles(installed), files, 'Extracted artifact must retain every runtime file')
    const data = path.join(output, 'data')
    mkdirSync(data)
    token = randomBytes(32).toString('hex')
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => ['systemroot', 'windir', 'path', 'pathext', 'comspec', 'temp', 'tmp'].includes(key.toLowerCase())),
    )
    Object.assign(env, { NODE_ENV: 'production', OPEN_FLOW_HOST: '127.0.0.1', OPEN_FLOW_PORT: '0', OPEN_FLOW_DATA_DIR: data, OPEN_FLOW_TOKEN: token })
    child = spawn(process.execPath, ['--no-node-snapshot', 'server/main.js'], { cwd: installed, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    exited = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })))
    let buffer = ''
    const listening = new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code) => reject(Error('Standalone server exited before readiness: ' + code)))
      child.stdout.on('data', (bytes) => {
        stdout += bytes.toString()
        buffer += bytes.toString()
        if (stdout.length > 1024 * 1024) {
          reject(Error('Standalone stdout exceeded its bound'))
          return
        }
        let end
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end)
          buffer = buffer.slice(end + 1)
          try {
            const message = JSON.parse(line)
            if (message.category === 'process.started' && message.type === 'listening') {
              assert.equal(message.host, '127.0.0.1')
              assert.ok(Number.isInteger(message.port) && message.port > 0 && message.port < 65536)
              resolve(`http://127.0.0.1:${message.port}`)
            }
          } catch {
            /* Only the child's structured listening event establishes readiness. */
          }
        }
      })
      child.stderr.on('data', (bytes) => {
        stderr = (stderr + bytes.toString()).slice(-1024 * 1024)
      })
    })
    let readinessTimer
    const origin = await Promise.race([
      listening,
      new Promise((_, reject) => {
        readinessTimer = setTimeout(() => reject(Error('Standalone server readiness timed out')), 60000)
      }),
    ]).finally(() => clearTimeout(readinessTimer))
    const checks = []
    for (const [name, route, authenticated, expected] of [
      ['health', '/healthz', false, 200],
      ['unauthenticated-control', '/v1/flows?limit=10', false, 401],
      ['authenticated-authoring-read', '/v1/flows?limit=10', true, 200],
    ]) {
      assert.equal(child.exitCode, null)
      assert.equal(child.signalCode, null)
      const response = await fetch(new URL(route, origin), {
        headers: authenticated ? { authorization: `Bearer ${token}` } : {},
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      })
      const body = await response.text()
      checks.push({ name, status: response.status, expected, bodySha256: sha(body) })
      assert.equal(response.status, expected, name)
    }
    assert.deepEqual(payloadFiles(dist), files, 'Build output changed during qualification')
    assert.equal(sha(readFileSync(archive)), artifact.sha256)
    assert.deepEqual(captureSourceIdentity(root), source, 'Source changed during qualification')
    receipt = {
      schemaVersion: 'cityos.open-flow-server-artifact.v1',
      source,
      artifact,
      files,
      node: process.version,
      checks,
      success: true,
      artifactStartupQualified: true,
      artifactBuildProvenanceQualified: false,
      distributionQualified: false,
      cmsInstallationQualified: false,
      imageQualified: false,
      activationQualified: false,
      nonClaims: [
        'Source is observed alongside the frozen payload; a separate build receipt must establish their relationship.',
        'The extracted Windows runtime serves real HTTP with a disposable operator identity. This does not establish CityOS workload/tenant binding, the server image or environment activation.',
      ],
    }
  } catch (error) {
    receipt = {
      schemaVersion: 'cityos.open-flow-server-artifact.v1',
      source,
      artifact,
      files,
      success: false,
      error: redact(String(error.message)),
      distributionQualified: false,
      cmsInstallationQualified: false,
      imageQualified: false,
      activationQualified: false,
    }
  } finally {
    try {
      if (child?.pid && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM')
        await Promise.race([exited, sleep(10000)])
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      }
      // Join stream closure as well as process exit before releasing the lease.
      // A spawn failure also emits close; it must not wait on an exit event.
      if (exited) await exited
      if (receipt) receipt.ownedRuntimeJoined = true
      for (const [name, value] of [
        ['stdout', stdout],
        ['stderr', stderr],
      ])
        writeFileSync(path.join(output, name + '.log'), redact(value))
      writeFileSync(path.join(output, 'receipt.json'), JSON.stringify({ ...receipt, observedAt: new Date().toISOString() }, null, 2) + '\n')
    } finally {
      release()
    }
  }
  return { output, receipt }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 3, 'Usage: qualify-server-artifact.mjs <CMS workspace>')
  const { output, receipt } = await qualifyServerArtifact(process.argv[2])
  console.log(JSON.stringify({ output, success: receipt.success, artifact: receipt.artifact, checks: receipt.checks, error: receipt.error }))
  process.exitCode = receipt.success ? 0 : 1
}
