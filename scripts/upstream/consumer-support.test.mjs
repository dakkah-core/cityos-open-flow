import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { assertTemporaryConsumerTarget, consumerDependency } from '../../packages/open-flow/scripts/consumerSupport.ts'

test('isolated npm consumers materialize the actual workspace catalog', () => {
  const workspace = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url)))
  const source = JSON.parse(readFileSync(new URL('../../packages/open-flow/package.json', import.meta.url)))
  assert.equal(source.devDependencies.react, 'catalog:')
  const dependencies = Object.fromEntries(
    ['react', 'react-dom', '@types/react', '@types/react-dom'].map((name) => [name, consumerDependency(workspace, name, source.devDependencies[name])]),
  )
  assert.doesNotMatch(JSON.stringify(dependencies), /catalog:/)
  for (const [name, version] of Object.entries(dependencies)) assert.equal(version, workspace.catalog[name])
})

test('consumer catalog resolution rejects missing or unresolved versions', () => {
  assert.throws(() => consumerDependency({}, 'react', 'catalog:'), /exact catalog version/)
  assert.throws(() => consumerDependency({ catalog: { react: 'catalog:' } }, 'react', 'catalog:'), /exact catalog version/)
  assert.throws(() => consumerDependency({}, 'react', 'workspace:*'), /exact catalog version/)
  assert.equal(consumerDependency({ catalogs: { fixture: { react: '19.3.1' } } }, 'react', 'catalog:fixture'), '19.3.1')
})

test('recursive consumer cleanup rejects siblings, parents and non-consumer roots', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'open-flow-consumer-'))
  try {
    mkdirSync(path.join(directory, 'node_modules'))
    assert.doesNotThrow(() => assertTemporaryConsumerTarget(directory))
    assert.doesNotThrow(() => assertTemporaryConsumerTarget(directory, path.join(directory, 'node_modules')))
    assert.throws(() => assertTemporaryConsumerTarget(directory, path.dirname(directory)), /outside/)
    assert.throws(() => assertTemporaryConsumerTarget(directory, `${directory}-sibling`), /outside/)
    assert.throws(() => assertTemporaryConsumerTarget(tmpdir()), /outside/)
  } finally {
    assertTemporaryConsumerTarget(directory)
    rmSync(directory, { recursive: true, force: true })
  }
})
