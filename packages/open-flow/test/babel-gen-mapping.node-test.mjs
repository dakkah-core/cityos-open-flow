import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
const root = fileURLToPath(new URL('../../../', import.meta.url))
const workspace = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const catalog = workspace.catalog
assert.equal(process.versions.node, readFileSync(path.join(root, '.node-version'), 'utf8').trim())
function ownGenerator() {
  const consumer = createRequire(path.join(root, 'packages/open-flow/package.json'))
  const traversal = createRequire(consumer.resolve('@babel/traverse'))
  const manifest = traversal.resolve('@babel/generator/package.json'),
    fromGenerator = createRequire(manifest)
  return { generatorEntry: traversal.resolve('@babel/generator'), generatorManifest: JSON.parse(readFileSync(manifest, 'utf8')), fromGenerator }
}
test('Open Flow uses its own stable mapping catalog through an exact Babel8 parent', () => {
  assert.match(catalog['@jridgewell/gen-mapping'], /^\d+\.\d+\.\d+$/u)
  assert.equal(workspace.overrides['@babel/generator@8.0.6']['@jridgewell/gen-mapping'], 'catalog:')
})

let loaded
function loadGenerator() {
  return (loaded ??= (async () => {
    const { generatorEntry, generatorManifest, fromGenerator } = ownGenerator()
    assert.equal(generatorManifest.version, '8.0.6', 'Exercise the exact changed parent, not a hoisted Babel7 generator')
    assert.equal(fromGenerator('@jridgewell/gen-mapping/package.json').version, catalog['@jridgewell/gen-mapping'])
    // require.resolve selects CommonJS UMD; consume its actual export object.
    const mapping = fromGenerator('@jridgewell/gen-mapping')
    const parser = await import(pathToFileURL(fromGenerator.resolve('@babel/parser')).href)
    const generator = await import(pathToFileURL(generatorEntry).href)
    const trace = fromGenerator('@jridgewell/trace-mapping')
    return { mapping, parser, generate: generator.generate, trace }
  })())
}
function positionOf(code, identifier) {
  const index = code.indexOf(identifier)
  assert(index >= 0, identifier + ' must be emitted')
  const prefix = code.slice(0, index).split('\n')
  return { line: prefix.length, column: prefix.at(-1).length }
}

test('the actual Babel8 generator binds the six stable mapping APIs it consumes', async () => {
  const { mapping, generate } = await loadGenerator()
  assert.equal(typeof generate, 'function')
  for (const name of ['GenMapping', 'setSourceContent', 'toEncodedMap', 'toDecodedMap', 'allMappings', 'maybeAddMapping']) {
    assert.equal(typeof mapping[name], 'function', name)
  }
})

test('actual Babel8 emission retains executable code and original source positions', async () => {
  const { parser, generate, trace } = await loadGenerator()
  const source = 'function greet(name) {\n  return "Hello " + name;\n}\n'
  const ast = parser.parse(source, { sourceType: 'script', sourceFilename: 'fixture/input.js' })
  const output = generate(ast, { sourceMaps: true, sourceFileName: 'fixture/input.js' }, source)
  assert.equal(runInNewContext(output.code + '\ngreet("Ada")'), 'Hello Ada')
  assert.equal(output.map.version, 3)
  assert.deepEqual(output.map.sources, ['fixture/input.js'])
  assert.deepEqual(output.map.sourcesContent, [source])
  assert.equal(typeof output.map.mappings, 'string')
  assert(output.map.mappings.length > 0)
  assert(Array.isArray(output.decodedMap.mappings) && output.decodedMap.mappings.length > 0)
  assert(Array.isArray(output.rawMappings) && output.rawMappings.length > 0)
  assert.deepEqual(output.map.ignoreList, [])
  const original = trace.originalPositionFor(new trace.TraceMap(output.map), positionOf(output.code, 'greet'))
  assert.equal(original.source, 'fixture/input.js')
  assert.equal(original.line, 1)
  assert.equal(original.column, 9)
})

test('actual Babel8 emission retains input-map chaining and original content', async () => {
  const { mapping, parser, generate, trace } = await loadGenerator()
  const source = 'function greet(name) { return "Hello " + name; }\n'
  const originalSource = '\n'.repeat(9) + '  ' + source
  const input = new mapping.GenMapping({ file: 'intermediate.js' })
  mapping.setSourceContent(input, 'original.ts', originalSource)
  mapping.maybeAddMapping(input, { generated: { line: 1, column: 0 }, source: 'original.ts', original: { line: 10, column: 2 }, name: 'greet' })
  const ast = parser.parse(source, { sourceType: 'script', sourceFilename: 'intermediate.js' })
  const output = generate(ast, { sourceMaps: true, sourceFileName: 'intermediate.js', inputSourceMap: mapping.toEncodedMap(input) }, source)
  assert.equal(runInNewContext(output.code + '\ngreet("Ada")'), 'Hello Ada')
  assert.deepEqual(output.map.sources, ['original.ts'])
  assert.deepEqual(output.map.sourcesContent, [originalSource])
  const original = trace.originalPositionFor(new trace.TraceMap(output.map), positionOf(output.code, 'greet'))
  assert.equal(original.source, 'original.ts')
  assert.equal(original.line, 10)
  assert.equal(original.column, 2)
})

test('actual Babel8 emission retains mappings for merged ASTs with two source files', async () => {
  const { parser, generate, trace } = await loadGenerator()
  const left = 'const left = 1;\n',
    right = 'const right = 2;\n'
  const ast = parser.parse(left, { sourceType: 'script', sourceFilename: 'left.js' })
  const other = parser.parse(right, { sourceType: 'script', sourceFilename: 'right.js' })
  ast.program.body.push(...other.program.body)
  const output = generate(ast, { sourceMaps: true }, { 'left.js': left, 'right.js': right })
  assert.equal(runInNewContext(output.code + '\nleft + right'), 3)
  assert.deepEqual(output.map.sources, ['left.js', 'right.js'])
  assert.deepEqual(output.map.sourcesContent, [left, right])
  const original = trace.originalPositionFor(new trace.TraceMap(output.map), positionOf(output.code, 'right'))
  assert.equal(original.source, 'right.js')
  assert.equal(original.line, 1)
  assert.equal(original.column, 6)
})
