import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const requireRoot = createRequire(path.join(root, 'package.json'))
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
const workspace = readJson(path.join(root, 'package.json'))
const version = '5.20261019.1-beta'
let context
function installed() {
  if (context) return context
  const wranglerManifest = requireRoot.resolve('wrangler/package.json')
  const wrangler = readJson(wranglerManifest)
  assert.equal(wrangler.version, workspace.catalog.wrangler)
  const fromWrangler = createRequire(wranglerManifest)
  const miniflareManifest = fromWrangler.resolve('miniflare/package.json')
  assert.equal(readJson(miniflareManifest).version, version)
  const consumer = createRequire(miniflareManifest)
  const formatter = consumer('youch')
  const formatterManifest = readJson(new URL('../package.json', pathToFileURL(consumer.resolve('youch'))))
  assert.equal(formatterManifest.version, workspace.catalog.youch)
  assert.match(formatterManifest.version, /^\d+\.\d+\.\d+$/u)
  context = { wranglerDirectory: path.dirname(wranglerManifest), consumer, formatter, esbuild: fromWrangler('esbuild') }
  return context
}
test('Miniflare uses the catalog-selected stable formatter', { concurrency: false }, async () => {
  assert.equal(workspace.overrides['miniflare@' + version].youch, 'catalog:')
  const { formatter } = installed(),
    youch = new formatter.Youch()
  const error = new Error('Stable formatter source fixture')
  error.stack = 'Error: Stable formatter source fixture\n    at Object.fetch (script-0:1:1)'
  youch.defineSourceLoader(async (frame) => (frame.fileName === 'script-0' ? { contents: 'export const sourceFixture = true;' } : undefined))
  youch.useTransformer((parsed) => {
    parsed.hint = 'Stable formatter transformer fixture'
  })
  const json = await youch.toJSON(error)
  assert.equal(json.frames[0].fileName, 'script-0')
  const html = await youch.toHTML(error)
  assert.match(html, /Stable formatter source fixture/)
  assert.match(html, /sourceFixture/)
  assert.match(html, /Stable formatter transformer fixture/)
})
test('the actual development middleware renders a worker error through stable Youch', { concurrency: false, timeout: 60000 }, async (t) => {
  const { consumer, formatter, esbuild, wranglerDirectory } = installed()
  const runtime = consumer('miniflare')
  assert.equal(typeof runtime.convertV4MiniflareOptions, 'function')
  const middleware = await esbuild.transform(readFileSync(path.join(wranglerDirectory, 'templates/middleware/middleware-miniflare3-json-error.ts'), 'utf8'), {
    loader: 'ts',
    format: 'esm',
  })
  const toHTML = formatter.Youch.prototype.toHTML
  let renderedHTML, renderError
  const render = t.mock.method(formatter.Youch.prototype, 'toHTML', async function (...args) {
    try {
      renderedHTML = await toHTML.apply(this, args)
      return renderedHTML
    } catch (error) {
      renderError = error
      throw error
    }
  })
  const options = {
    compatibilityDate: '2026-05-15',
    modules: [
      {
        type: 'ESModule',
        path: 'stable-error-worker.mjs',
        contents:
          'import jsonError from "./stable-error-middleware.mjs"; export default {fetch(request,env,ctx){return jsonError(request,env,ctx,{next(){throw new Error("Stable Miniflare runtime fixture");}});}}',
      },
      { type: 'ESModule', path: 'stable-error-middleware.mjs', contents: middleware.code },
    ],
  }
  const worker = new runtime.Miniflare(runtime.convertV4MiniflareOptions(options))
  try {
    const response = await fetch(await worker.ready, { signal: t.signal, headers: { 'accept': 'text/html', 'user-agent': 'Stable tooling regression' } })
    assert.equal(response.status, 500)
    const html = await response.text()
    assert.match(response.headers.get('content-type') ?? '', /text\/html/)
    assert.match(html, /Stable Miniflare runtime fixture/)
    assert.ifError(renderError)
    assert.equal(typeof renderedHTML, 'string', 'The real formatter must complete successfully')
    assert.equal(html, renderedHTML, 'The HTTP response must be the formatter output, not an error fallback')
    assert.equal(render.mock.calls.length, 1, 'The actual stable formatter must render, not a fallback')
  } finally {
    await worker.dispose()
  }
})
