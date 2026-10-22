import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertServerBuildEvidence } from './qualify-server-build.mjs'

function evidence() {
  const source = { sourceSha: 'a'.repeat(40), sourceDigest: 'b'.repeat(64), dirty: false }
  return { before: source, after: structuredClone(source), build: { exitCode: 0, logSha256: 'c'.repeat(64) }, artifactSha256: 'd'.repeat(64),
    runtime: { success: true, artifactStartupQualified: true, ownedRuntimeJoined: true, source: structuredClone(source), artifact: { sha256: 'd'.repeat(64) },
      checks: [{ name: 'health', status: 200, expected: 200 }, { name: 'unauthenticated-control', status: 401, expected: 401 }, { name: 'authenticated-authoring-read', status: 200, expected: 200 }] } }
}

test('build evidence binds the successful build to the exact source and tested archive', () => {
  assert.doesNotThrow(() => assertServerBuildEvidence(evidence()))
  for (const mutate of [value => { value.after.sourceDigest = 'e'.repeat(64) }, value => { value.runtime.source.sourceSha = 'f'.repeat(40) },
    value => { value.artifactSha256 = 'e'.repeat(64) }, value => { value.build.exitCode = 1 }]) {
    const value = evidence(); mutate(value); assert.throws(() => assertServerBuildEvidence(value))
  }
})

test('startup alone, an unjoined process or an unauthenticated control success cannot qualify a build', () => {
  for (const mutate of [value => { value.runtime.ownedRuntimeJoined = false }, value => { value.runtime.artifactStartupQualified = false },
    value => { value.runtime.checks.pop() }, value => { value.runtime.checks[1].status = 200 }]) {
    const value = evidence(); mutate(value); assert.throws(() => assertServerBuildEvidence(value))
  }
})
