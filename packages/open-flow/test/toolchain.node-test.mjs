import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
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

test('the approved browser API binding cannot become a build compiler or spread into other source consumers', async () => {
  const selected = manifest.catalogs['typescript-compat']['typescript-lsp']
  assert.match(selected, /^npm:typescript@6\.\d+\.\d+$/)
  assert.match(manifest.catalog.typescript, /^7\.\d+\.\d+$/)
  const allowed = new Set([
    'packages/open-flow/src/workbench/browser/typeScriptWorker.ts',
    'packages/open-flow/src/workbench/browser/typeScriptShadow.ts',
    'packages/open-flow/src/workbench/browser/typeScriptShadow.test.ts',
    'packages/open-flow/src/workbench/browser/typeScriptDiagnostics.ts',
    'packages/open-flow/src/workbench/browser/codeActionsTyping.test.ts',
  ])
  async function inspect(directory) {
    for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`
      if (entry.isDirectory()) await inspect(relative)
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
        const source = await readFile(path.join(root, relative), 'utf8')
        if (/(?:from\s*|import\s*\(|require\s*\()\s*['"]typescript-lsp['"]/.test(source)) {
          assert.ok(allowed.has(relative), `Unapproved browser API consumer: ${relative}`)
        }
      }
    }
  }
  for (const directory of ['packages/open-flow/src', 'packages/command/src', 'apps/server/browser', 'apps/server/common', 'apps/server/node']) await inspect(directory)
  for (const member of members) {
    const pkg = await readJson(path.join(root, member))
    for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
      assert.doesNotMatch(command, /typescript-lsp/, `${member}/${name}`)
    }
  }
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
