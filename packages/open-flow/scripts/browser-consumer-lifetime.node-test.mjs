import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { assertTemporaryConsumerTarget } from './consumerSupport.ts'

const templates = new URL('./npm-package-consumer/', import.meta.url)
const execFileAsync = promisify(execFile)

async function withProcessHelper(run) {
  const root = await mkdtemp(path.join(tmpdir(), 'open-flow-consumer-'))
  try {
    const file = path.join(root, 'browser-process.mjs')
    await copyFile(new URL('browser-process.mjs.txt', templates), file)
    const { joinBrowserProcess } = await import(pathToFileURL(file).href)
    assert.equal(typeof joinBrowserProcess, 'function')
    await run(joinBrowserProcess)
  } finally {
    assertTemporaryConsumerTarget(root)
    await rm(root, { recursive: true, force: true })
  }
}

test('browser phase admission waits for process close rather than exit', async () => {
  await withProcessHelper(async (joinBrowserProcess) => {
    // The external ChildProcess event contract can deliver exit before stdio
    // closes. Drive that boundary explicitly; Windows grandchildren do not
    // reliably retain inherited pipe handles as a portable real-process fixture.
    const child = new EventEmitter()
    let minifying = false
    const joined = joinBrowserProcess(child, 'bundle').then(() => {
      minifying = true
    })
    child.emit('exit', 0, null)
    await Promise.resolve()
    assert.equal(minifying, false, 'Exit must not admit the next memory lifetime.')
    child.emit('close', 0, null)
    await joined
    assert.equal(minifying, true)
  })
})

test('the phase join accepts an actual clean child close', async () => {
  await withProcessHelper(async (joinBrowserProcess) => {
    await joinBrowserProcess(spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore', windowsHide: true }), 'bundle')
  })
})

test('a failed bundle prevents the next browser phase', async () => {
  await withProcessHelper(async (joinBrowserProcess) => {
    let minifying = false
    await assert.rejects(async () => {
      await joinBrowserProcess(spawn(process.execPath, ['-e', 'process.exit(9)'], { stdio: 'ignore' }), 'bundle')
      minifying = true
    }, /bundle failed: code=9/)
    assert.equal(minifying, false)
  })
})

// Run from an installed Vite 7.3.6 consumer, before its canonical cleanup.
// A fresh fixture links that real dependency; no install or substitute bundler.
async function withConsumer(run) {
  const require = createRequire(path.join(process.cwd(), 'package.json'))
  const vitePackage = require.resolve('vite/package.json')
  assert.equal(JSON.parse(await readFile(vitePackage, 'utf8')).version, '7.3.6')
  const root = await mkdtemp(path.join(tmpdir(), 'open-flow-consumer-'))
  try {
    await mkdir(path.join(root, 'node_modules'))
    await symlink(path.dirname(vitePackage), path.join(root, 'node_modules/vite'), process.platform === 'win32' ? 'junction' : 'dir')
    for (const name of ['browser', 'browser-process', 'browser-bundle', 'browser-minify']) {
      await copyFile(new URL(`${name}.mjs.txt`, templates), path.join(root, `${name}.mjs`))
    }
    await writeFile(path.join(root, 'package.json'), '{"private":true,"type":"module"}')
    await writeFile(path.join(root, 'preview.mjs'), 'import "./fixture.css"; globalThis.loadFixture = () => import("./lazy.mjs");')
    await writeFile(path.join(root, 'lazy.mjs'), 'export const label = "مرحبا";')
    await writeFile(path.join(root, 'fixture.css'), '.fixture { color: rgb(255, 0, 0); }')
    await run(root)
  } finally {
    assertTemporaryConsumerTarget(root)
    await rm(root, { recursive: true, force: true })
  }
}

test('real Vite bundle and serial esbuild pass cover all chunks and preserve processed CSS', { timeout: 30_000 }, async () => {
  await withConsumer(async (root) => {
    const output = path.join(root, 'output')
    await execFileAsync(process.execPath, [path.join(root, 'browser-bundle.mjs'), output], { cwd: root })
    const inventory = JSON.parse(await readFile(path.join(output, 'inventory.json'), 'utf8'))
    assert.ok(inventory.chunks.some((chunk) => chunk.isDynamicEntry))
    assert.equal(inventory.options.target, 'esnext')
    assert.equal(inventory.options.format, 'esm')
    assert.equal(inventory.options.charset, 'utf8')
    assert.equal(inventory.options.legalComments, 'none')
    assert.equal(inventory.options.minify, true)
    assert.equal(inventory.options.treeShaking, true)
    assert.equal(inventory.options.sourcemap, true)
    const css = (await readdir(output, { recursive: true })).filter((file) => file.endsWith('.css'))
    assert.ok(css.length > 0)
    const styles = await Promise.all(css.map((file) => readFile(path.join(output, file), 'utf8')))
    assert.ok(
      styles.every((style) => !style.includes('rgb(255, 0, 0)')),
      'Vite must still minify CSS.',
    )
    const { stdout } = await execFileAsync(process.execPath, [path.join(root, 'browser-minify.mjs'), output], { cwd: root })
    for (const { fileName } of inventory.chunks) assert.ok(stdout.includes(`chunk:pass ${fileName}\n`))
    assert.deepEqual(await Promise.all(css.map((file) => readFile(path.join(output, file), 'utf8'))), styles)
    const lazy = inventory.chunks.find((chunk) => chunk.isDynamicEntry)
    assert.ok((await readFile(path.join(output, lazy.fileName), 'utf8')).includes('مرحبا'))
    const parent = await execFileAsync(process.execPath, [path.join(root, 'browser.mjs')], { cwd: root })
    const passed = parent.stdout.indexOf('[npm-package:browser] bundle:pass')
    assert.ok(passed >= 0)
    assert.ok(parent.stdout.indexOf('[npm-package:browser] minify:start') > passed)
    assert.ok(parent.stdout.includes('[npm-package:browser] minify:pass'))
  })
})

test('real esbuild rejects malformed JavaScript in a lazy chunk, not just the entry', { timeout: 30_000 }, async () => {
  await withConsumer(async (root) => {
    const output = path.join(root, 'output')
    await execFileAsync(process.execPath, [path.join(root, 'browser-bundle.mjs'), output], { cwd: root })
    const inventory = JSON.parse(await readFile(path.join(output, 'inventory.json'), 'utf8'))
    const lazy = inventory.chunks.find((chunk) => chunk.isDynamicEntry)
    assert.ok(lazy)
    await writeFile(path.join(output, lazy.fileName), 'export const broken = ;')
    await assert.rejects(execFileAsync(process.execPath, [path.join(root, 'browser-minify.mjs'), output], { cwd: root }), (error) => {
      assert.ok(error.stderr.includes(lazy.fileName))
      assert.match(error.stderr, /Transform failed/)
      return true
    })
  })
})

test('an unlisted JavaScript file cannot bypass minification', { timeout: 30_000 }, async () => {
  await withConsumer(async (root) => {
    const output = path.join(root, 'output')
    await execFileAsync(process.execPath, [path.join(root, 'browser-bundle.mjs'), output], { cwd: root })
    await writeFile(path.join(output, 'unlisted.js'), 'export const omitted = true;')
    await assert.rejects(execFileAsync(process.execPath, [path.join(root, 'browser-minify.mjs'), output], { cwd: root }), (error) => {
      assert.match(error.stderr, /Incomplete browser JavaScript inventory/)
      return true
    })
  })
})
