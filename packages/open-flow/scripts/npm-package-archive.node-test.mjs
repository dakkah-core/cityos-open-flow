import { packTar } from 'modern-tar'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { assertTemporaryConsumerTarget } from './consumerSupport.ts'
import { joinArchiveProcess, verifyArchiveInChild } from './npm-package-archive-process.ts'

const version = '0.0.0-archive-fixture'
const font = 'dist/browser/assets/font-0123456789abcdef.woff2'
const worker = fileURLToPath(new URL('./npm-package-archive-worker.ts', import.meta.url))
const tokens = `--ui-accent: red; --ui-accent-foreground: black;
  --ui-background: white; --ui-border: gray; --ui-card: white;
  --ui-card-foreground: black; --ui-destructive: red; --ui-foreground: black;
  --ui-input: gray; --ui-muted: gray; --ui-muted-foreground: black;
  --ui-popover: white; --ui-popover-foreground: black; --ui-primary: red;
  --ui-primary-foreground: black; --ui-radius: 4px; --ui-ring: red;
  --ui-secondary: gray; --ui-secondary-foreground: black;`

// A real small tarball satisfying the published archive contract. Each negative
// fixture changes its contents and goes through the production child verifier.
function fixture() {
  const manifest = {
    name: '@oomol-lab/open-flow',
    version,
    types: './dist/index.d.ts',
    exports: {
      '.': { types: './dist/index.d.ts', import: './dist/index.js' },
      './preview.css': './dist/browser/preview.css',
      './workbench.css': './dist/browser/workbench.css',
      './theme.css': './dist/browser/theme.css',
      './command': { types: './dist/command/index.d.ts', import: './dist/command/index.js' },
    },
    peerDependencies: { effect: '3.21.0' },
  }
  const files = new Map([
    ['package.json', JSON.stringify(manifest)],
    ['LICENSE', 'Apache License, Version 2.0'],
    ['NOTICE', 'Open Flow fixture notice'],
    ['README.md', '# Archive consumer fixture'],
    ['dist/browser/licenses.md', 'Browser dependency license notices'],
    ['dist/command/licenses.md', 'Command dependency license notices'],
    ['dist/index.js', 'export const fixture = true;'],
    ['dist/index.d.ts', 'export declare const fixture: boolean;'],
    ['dist/command/index.js', 'export const command = true;'],
    ['dist/command/index.d.ts', 'export declare const command: boolean;'],
    ['dist/browser/preview.css', `.open-flow-preview { ${tokens} background: url("./assets/preview.png"); }`],
    [
      'dist/browser/workbench.css',
      `.open-flow-workbench { ${tokens} }
      .i-lucide-light\\:zoom-in {} .i-lucide-light\\:zoom-out {} .i-lucide-light\\:scan {}
      .i-codicon\\:copy {} .i-codicon\\:trash {}
      :where(.open-flow-workbench) .hidden { display: none; }
      @font-face { font-family: fixture; src: url(./assets/font-0123456789abcdef.woff2); }`,
    ],
    ['dist/browser/theme.css', `.open-flow-theme { ${tokens} } .open-flow-theme[data-theme='dark'] { color: white; }`],
    ['dist/browser/assets/preview.png', Buffer.from([137, 80, 78, 71])],
    [font, Buffer.from('wOF2 archive font fixture')],
  ])
  return { files, manifest }
}

async function withArchive(change, run, encode = (tar) => gzipSync(tar)) {
  const root = await mkdtemp(path.join(tmpdir(), 'open-flow-consumer-'))
  try {
    const { files, manifest } = fixture()
    change(files, manifest)
    files.set('package.json', JSON.stringify(manifest))
    const tar = await packTar(
      [...files].map(([name, content]) => {
        const body = typeof content === 'string' ? Buffer.from(content) : content
        return { header: { name: `package/${name}`, type: 'file', size: body.byteLength }, body }
      }),
    )
    const tarball = path.join(root, 'fixture.tgz')
    await writeFile(tarball, encode(tar))
    await run(tarball)
  } finally {
    assertTemporaryConsumerTarget(root)
    await rm(root, { recursive: true, force: true })
  }
}

test('real archive worker returns only the consumer fact after its native process closes', { timeout: 15_000 }, async () => {
  await withArchive(
    () => {},
    async (tarball) => {
      const child = spawn(process.execPath, [worker, tarball, version], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      let closed = false
      child.once('close', () => {
        closed = true
      })
      assert.deepEqual(await joinArchiveProcess(child, 10_000), { effectPeer: '3.21.0' })
      assert.equal(closed, true)
      assert.equal(child.exitCode, 0)
      assert.deepEqual(await verifyArchiveInChild(tarball, version), { effectPeer: '3.21.0' })
    },
  )
})

const rejectedFixtures = [
  ...['LICENSE', 'NOTICE', 'README.md', 'dist/browser/licenses.md', 'dist/command/licenses.md'].map((name) => [
    `missing legal/documentation entry ${name}`,
    (files) => files.delete(name),
    /Missing npm package entry/,
  ]),
  ['missing Workbench font', (files) => files.delete(font), /Missing Workbench font/],
  ['missing preview asset', (files) => files.delete('dist/browser/assets/preview.png'), /Missing preview asset/],
  ['missing advertised DTS', (files) => files.delete('dist/index.d.ts'), /Missing npm package target/],
  ['missing conditional runtime export', (files) => files.delete('dist/command/index.js'), /Missing npm package target/],
  ['absolute export target', (_, manifest) => (manifest.exports['./invalid'] = '/outside.js'), /Package target must be relative/],
  ['invalid condition map', (_, manifest) => (manifest.exports['./invalid'] = null), /Expected an export target/],
  ['missing top-level types target', (_, manifest) => (manifest.types = './missing.d.ts'), /Missing npm package target/],
  ['wrong package name', (_, manifest) => (manifest.name = 'unrelated-package'), /Archive verification failed/],
  ['wrong package version', (_, manifest) => (manifest.version = '0.0.0-other'), /Archive verification failed/],
  ['missing Effect peer version', (_, manifest) => delete manifest.peerDependencies.effect, /Missing packed Effect peer version/],
  ['excluded source payload', (files) => files.set('src/private.ts', 'export {};'), /Archive verification failed/],
  ['excluded native runtime', (files) => files.set('dist/isolated-vm-runtime.js', 'export {};'), /Archive verification failed/],
  ['excluded browser source map', (files) => files.set('dist/browser/preview.js.map', '{}'), /Archive verification failed/],
  [
    'missing scoped hidden utility',
    (files) =>
      files.set('dist/browser/workbench.css', files.get('dist/browser/workbench.css').replace(':where(.open-flow-workbench) .hidden', '.other .hidden')),
    /Archive verification failed/,
  ],
  [
    'leaking unscoped hidden utility',
    (files) => files.set('dist/browser/workbench.css', `${files.get('dist/browser/workbench.css')} .hidden { display: none; }`),
    /Archive verification failed/,
  ],
  [
    'missing packaged icon CSS',
    (files) => files.set('dist/browser/workbench.css', files.get('dist/browser/workbench.css').replace('.i-codicon\\:trash', '.wrong-icon')),
    /Missing packaged icon CSS/,
  ],
  ['missing theme root', (files) => files.set('dist/browser/theme.css', `.unrelated { ${tokens} }`), /Archive verification failed/],
  [
    'missing dark theme selector',
    (files) => files.set('dist/browser/theme.css', files.get('dist/browser/theme.css').replace("[data-theme='dark']", "[data-theme='light']")),
    /Archive verification failed/,
  ],
  ...['preview', 'workbench', 'theme'].map((style) => [
    `missing ${style} theme token`,
    (files) => files.set(`dist/browser/${style}.css`, files.get(`dist/browser/${style}.css`).replace('--ui-accent:', '--unrelated:')),
    /Missing --ui-accent/,
  ]),
  ...['preview', 'workbench'].map((style) => [
    `inlined ${style} font`,
    (files) => files.set(`dist/browser/${style}.css`, `${files.get(`dist/browser/${style}.css`)} @font-face { src: url(data:font/woff2;base64,AAAA); }`),
    /Archive verification failed/,
  ]),
  ...['bin', 'dependencies', 'devDependencies', 'main', 'module', 'scripts'].map((field) => [
    `forbidden packed manifest field ${field}`,
    (_, manifest) => (manifest[field] = {}),
    /Archive verification failed/,
  ]),
]

for (const [name, change, diagnostic] of rejectedFixtures) {
  test(`production archive verifier rejects ${name}`, { timeout: 15_000 }, async () => {
    await withArchive(change, async (tarball) => {
      let admittedConsumer = false
      await assert.rejects(async () => {
        await verifyArchiveInChild(tarball, version)
        admittedConsumer = true
      }, diagnostic)
      assert.equal(admittedConsumer, false)
    })
  })
}

test('production archive verifier rejects gzip corruption and tar checksum corruption', { timeout: 15_000 }, async () => {
  for (const encode of [
    () => Buffer.from('not a gzip archive'),
    (tar) => gzipSync(tar).subarray(0, 24),
    (tar) => {
      const corrupted = Buffer.from(tar)
      corrupted[0] ^= 1
      return gzipSync(corrupted)
    },
  ]) {
    await withArchive(
      () => {},
      async (tarball) => {
        await assert.rejects(verifyArchiveInChild(tarball, version), /Archive verification failed/)
      },
      encode,
    )
  }
})

test('archive join admits neither a result nor a failure before close', async () => {
  // Explicitly drive the ChildProcess event contract: exit may precede pipe
  // closure. The real-worker fixture above covers native process termination.
  for (const code of [0, 7]) {
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => true
    let settled = false
    const joined = joinArchiveProcess(child, 1000)
    const outcome = joined.then(
      (facts) => {
        settled = true
        return facts
      },
      (error) => {
        settled = true
        return error
      },
    )
    child.stdout.write('{"effectPeer":"3.21.0"}\n')
    child.emit('exit', code, null)
    await Promise.resolve()
    assert.equal(settled, false)
    child.emit('close', code, null)
    const result = await outcome
    if (code === 0) assert.deepEqual(result, { effectPeer: '3.21.0' })
    else assert.match(result.message, /code=7/)
  }
})

test('archive result overflow kills its owner but still waits for close', async () => {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  let killed = false
  child.kill = () => {
    killed = true
    return true
  }
  let settled = false
  const outcome = joinArchiveProcess(child, 1000).catch((error) => {
    settled = true
    return error
  })
  child.stdout.write(Buffer.alloc(2048))
  await Promise.resolve()
  assert.equal(killed, true)
  assert.equal(settled, false, 'A kill request cannot admit the next allocation lifetime.')
  child.emit('close', null, 'SIGKILL')
  assert.match((await outcome).message, /result exceeds 1024 bytes/)
})

test('archive join propagates failed spawn and nonzero native exit', { timeout: 10_000 }, async () => {
  const missing = spawn(path.join(tmpdir(), 'open-flow-archive-missing-executable', 'bun'), [], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  // Bun's child_process reports its own missing-executable diagnostic; Node
  // reports ENOENT. Verify the native provider's failure rather than requiring
  // Node's spelling from the actual Bun boundary.
  await assert.rejects(joinArchiveProcess(missing, 3000), process.versions.bun ? /Executable not found in \$PATH:/ : /ENOENT/)
  const failed = spawn(process.execPath, ['-e', 'process.stderr.write("fixture failure"); process.exit(9)'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  await assert.rejects(joinArchiveProcess(failed, 3000), /code=9[\s\S]*fixture failure/)
})

test('archive deadline kills and joins a real stalled child before rejecting', { timeout: 10_000 }, async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let closed = false
  child.once('close', () => {
    closed = true
  })
  await assert.rejects(joinArchiveProcess(child, 250), /timed out after 250ms/)
  assert.equal(closed, true)
})

test('archive IPC rejects oversized output and malformed or payload-bearing success results', { timeout: 15_000 }, async () => {
  for (const [script, diagnostic] of [
    ['process.stdout.write("x".repeat(2048)); setInterval(() => {}, 1000)', /result exceeds 1024 bytes/],
    ['process.stderr.write("x".repeat(32768)); setInterval(() => {}, 1000)', /diagnostics exceed 16384 bytes/],
    ['process.stdout.write("not JSON")', /JSON/],
    ['process.stdout.write(JSON.stringify({effectPeer:"3.21.0",entries:["retained payload"]}))', /only the consumer peer version/],
    ['process.stdout.write(JSON.stringify({effectPeer:42}))', /Invalid archive Effect peer version/],
  ]) {
    const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let closed = false
    child.once('close', () => {
      closed = true
    })
    await assert.rejects(joinArchiveProcess(child, 2000), (error) => {
      assert.match(error.message, diagnostic)
      assert.ok(Buffer.byteLength(error.message) < 17 * 1024, 'Diagnostic retention must stay bounded.')
      return true
    })
    assert.equal(closed, true)
  }
})

test('checker retains the archive process boundary before consumer admission', async () => {
  // This is an intentional architectural boundary: accidentally importing the
  // parser in the parent would reintroduce the retained allocation lifetime.
  const source = await readFile(new URL('./check-npm-package.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /modern-tar|gunzipSync|readPackedText|packedManifest/)
  assert.ok(source.indexOf('await verifyArchiveInChild(') < source.indexOf('await verifyConsumer()'))
  assert.ok(source.indexOf('await verifyArchiveInChild(') >= 0)
})
