import assert from 'node:assert/strict'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { dockerQualificationArguments, assertImmutableLinuxImage, dockerDiagnosticSummary } from './docker-image-contract.mjs'
const image = 'sha256:' + 'a'.repeat(64)

test('the qualification workflow parses without duplicate YAML keys', () => {
  const require = createRequire(new URL('../../packages/open-flow/package.json', import.meta.url))
  const { parseDocument } = require('yaml')
  const source = readFileSync(new URL('../../.github/workflows/ci.yaml', import.meta.url), 'utf8')
  const document = parseDocument(source, { uniqueKeys: true })
  assert.deepEqual(document.errors, [])
  const duplicate = parseDocument('with:\n  fetch-depth: 0\n  fetch-depth: 0\n', { uniqueKeys: true })
  assert.equal(duplicate.errors.length, 1)
})
test('failure diagnostics preserve a log identity without emitting setup credentials', () => {
  const summary = dockerDiagnosticSummary('{"setupCode":"fixture-only-credential","state":"failed"}')
  assert.match(summary.sha256, /^[a-f0-9]{64}$/u)
  assert.ok(summary.bytes > 0)
  assert.doesNotMatch(JSON.stringify(summary), /fixture-only-credential|setupCode/u)
})
test('the existing developer smoke mode remains available while exact-image mode cannot rebuild', () => {
  assert.deepEqual(dockerQualificationArguments([], process.cwd()), { imageId: undefined, receiptPath: undefined })
  assert.deepEqual(dockerQualificationArguments(['--image', image, '--receipt', '.build/upstream/image/receipt.json'], process.cwd()), {
    imageId: image, receiptPath: path.resolve('.build/upstream/image/receipt.json'),
  })
})
test('tags, duplicate flags, unknown options and receipt path escapes are rejected', () => {
  for (const args of [['--image', 'server:latest'], ['--image'], ['--image', image, '--image', image], ['--unknown', image],
    ['--receipt', '.build/upstream/proof.json'], ['--image', image, '--receipt', '../outside.json']]) {
    assert.throws(() => dockerQualificationArguments(args, process.cwd()))
  }
})
test('Linux qualification requires the same immutable image and the observed Linux architecture', () => {
  const observed = { Id: image, Os: 'linux', Architecture: 'amd64' }
  assert.equal(assertImmutableLinuxImage(observed, image), observed)
  for (const changed of [{ ...observed, Os: 'windows' }, { ...observed, Id: 'sha256:' + 'b'.repeat(64) },
    { ...observed, Architecture: 'unknown' }]) assert.throws(() => assertImmutableLinuxImage(changed, image))
})
