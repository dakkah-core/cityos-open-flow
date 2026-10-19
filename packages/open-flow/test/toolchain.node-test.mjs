import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { stageNpmPackage } from '../src/distribution/node/npmPackage.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const readJson = async file => JSON.parse(await readFile(file, 'utf8'))
const manifest = await readJson(path.join(root, 'package.json'))
const members = ['package.json', 'packages/open-flow/package.json', 'packages/command/package.json', 'apps/server/package.json']

test('registry dependencies use the owning Bun catalog and retain workspace edges', async () => {
  for (const member of members) {
    const pkg = await readJson(path.join(root, member))
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const [name, value] of Object.entries(pkg[field] ?? {})) {
        if (value.startsWith('workspace:')) continue
        assert.match(value, /^catalog:/, `${member}: ${name}`)
        const catalog = value === 'catalog:' ? manifest.catalog : manifest.catalogs?.[value.slice(8)]
        assert.ok(catalog?.[name], `${member}: missing catalog entry for ${name}`)
      }
    }
  }
  assert.equal(manifest.catalog.typescript, '7.0.2')
  assert.match(manifest.catalog['@types/node'], /^26\./)
  assert.equal(manifest.catalogs['typescript-compat']['typescript-lsp'], 'npm:typescript@6.0.2')
})

test('Node and Bun selectors agree with package and container consumers', async () => {
  const node = (await readFile(path.join(root, '.node-version'), 'utf8')).trim()
  const bun = (await readFile(path.join(root, '.bun-version'), 'utf8')).trim()
  assert.match(node, /^26\.\d+\.\d+$/)
  assert.equal(manifest.engines.node, '>=26.0.0 <27.0.0')
  assert.equal(manifest.packageManager, `bun@${bun}`)
  const dockerfile = await readFile(path.join(root, 'apps/server/Dockerfile'), 'utf8')
  assert.ok(dockerfile.includes(`FROM oven/bun:${bun} AS bun`))
  assert.ok(dockerfile.includes(`FROM node:${node}-bookworm AS build`))
  assert.ok(dockerfile.includes(`FROM node:${node}-bookworm-slim AS runtime`))
  const { buildBunVersion } = await import('../../command/src/cli/common/version.ts')
  assert.equal(buildBunVersion, bun)
})

test('package staging emits concrete stable peers from the owning catalog', async t => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'open-flow-catalog-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const sourceRoot = path.join(temporary, 'packages/open-flow')
  const packageRoot = path.join(temporary, 'out')
  await mkdir(path.join(sourceRoot, 'skills'), { recursive: true })
  await writeFile(path.join(sourceRoot, 'LICENSE'), 'fixture license')
  await writeFile(path.join(sourceRoot, 'NOTICE'), 'fixture notice')
  const catalog = { effect: '4.0.5', zod: '4.6.7', react: '19.3.1', 'react-dom': '19.3.1' }
  await writeFile(path.join(temporary, 'package.json'), JSON.stringify({ catalog }))
  await stageNpmPackage({ sourceRoot, packageRoot, version: '0.1.0' })
  const packed = await readJson(path.join(packageRoot, 'package.json'))
  assert.deepEqual(packed.peerDependencies, catalog)
  assert.doesNotMatch(JSON.stringify(packed), /catalog:|4\.0\.0-rc\./)
  for (const bad of [{ ...catalog, effect: '4.0.0-rc.113' }, { ...catalog, effect: undefined }]) {
    await writeFile(path.join(temporary, 'package.json'), JSON.stringify({ catalog: bad }))
    await assert.rejects(stageNpmPackage({ sourceRoot, packageRoot, version: '0.1.0' }), /stable catalog/)
  }
})
