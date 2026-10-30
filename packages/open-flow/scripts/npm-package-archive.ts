import { unpackTar } from 'modern-tar'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'

export interface ArchiveFacts {
  readonly effectPeer: string
}

const sharedUiTokens = [
  '--ui-accent',
  '--ui-accent-foreground',
  '--ui-background',
  '--ui-border',
  '--ui-card',
  '--ui-card-foreground',
  '--ui-destructive',
  '--ui-foreground',
  '--ui-input',
  '--ui-muted',
  '--ui-muted-foreground',
  '--ui-popover',
  '--ui-popover-foreground',
  '--ui-primary',
  '--ui-primary-foreground',
  '--ui-radius',
  '--ui-ring',
  '--ui-secondary',
  '--ui-secondary-foreground',
] as const

// Imported only by the finite archive worker, never by the checker parent.
export async function verifyNpmPackageArchive(tarballPath: string, expectedVersion: string): Promise<ArchiveFacts> {
  const entries = await unpackTar(gunzipSync(await readFile(tarballPath)), { strict: true })
  const entryNames = entries.map((entry) => entry.header.name)
  // Documentation and legal notices must ship even though consumers do not import them.
  for (const expected of ['LICENSE', 'NOTICE', 'README.md', 'dist/browser/licenses.md', 'dist/command/licenses.md']) {
    assert.ok(entryNames.includes(`package/${expected}`), `Missing npm package entry ${expected}.`)
  }
  assert.equal(
    entryNames.some((name) => name.includes('/src/')),
    false,
  )
  assert.equal(
    entryNames.some((name) => name.includes('isolated-vm-runtime')),
    false,
  )
  assert.equal(
    entryNames.every((name) => !name.startsWith('package/dist/browser/') || !name.endsWith('.map')),
    true,
  )

  const packedManifest = JSON.parse(readPackedText('package.json')) as Record<string, unknown>
  assert.equal(packedManifest.name, '@oomol-lab/open-flow')
  assert.equal(packedManifest.version, expectedVersion)
  // Validate advertised targets without freezing the internal output layout or export inventory.
  assert.ok(packedManifest.exports && typeof packedManifest.exports == 'object')
  verifyExportTargets(packedManifest.exports)
  assert.equal(typeof packedManifest.types, 'string')
  verifyExportTargets(packedManifest.types)
  for (const forbidden of ['bin', 'dependencies', 'devDependencies', 'main', 'module', 'scripts']) {
    assert.equal(Object.hasOwn(packedManifest, forbidden), false)
  }

  const previewStyle = readPackedText('dist/browser/preview.css')
  for (const token of sharedUiTokens) assert.ok(previewStyle.includes(`${token}:`), `Missing ${token} from the published preview CSS.`)
  assert.doesNotMatch(previewStyle, /data:font\//)
  for (const [, asset] of previewStyle.matchAll(/url\((?:["'])?(\.\/assets\/[^)"']+)/g)) {
    assert.ok(
      entries.some((entry) => entry.header.name == `package/dist/browser/${asset!.slice(2)}`),
      `Missing preview asset ${asset}`,
    )
  }
  const workbenchStyle = readPackedText('dist/browser/workbench.css')
  for (const icon of ['i-lucide-light:zoom-in', 'i-lucide-light:zoom-out', 'i-lucide-light:scan', 'i-codicon:copy', 'i-codicon:trash']) {
    assert.ok(workbenchStyle.includes(`.${icon.replaceAll(':', '\\:')}`), `Missing packaged icon CSS for ${icon}.`)
  }
  assert.match(workbenchStyle, /:where\([^)]*\.open-flow-workbench[^)]*\)\s+\.hidden\s*\{\s*display:\s*none\s*;?\s*\}/)
  for (const token of sharedUiTokens) assert.ok(workbenchStyle.includes(`${token}:`), `Missing ${token} from the published Workbench CSS.`)
  const themeStyle = readPackedText('dist/browser/theme.css')
  assert.match(themeStyle, /\.open-flow-theme\s*\{/)
  assert.match(themeStyle, /\.open-flow-theme\[data-theme='dark'\]/)
  for (const token of sharedUiTokens) assert.ok(themeStyle.includes(`${token}:`), `Missing ${token} from the published product theme CSS.`)
  assert.doesNotMatch(workbenchStyle, /(?:^|[{},])\s*\.hidden\s*\{\s*display:\s*none/)
  assert.doesNotMatch(workbenchStyle, /data:font\//)
  const referencedFonts = [...workbenchStyle.matchAll(/url\((\.\/assets\/font-[a-f\d]{16}\.(?:woff2|woff|ttf))\)/g)].map(
    (match) => `package/dist/browser/${match[1]!.slice(2)}`,
  )

  assert.ok(referencedFonts.length > 0)
  for (const font of referencedFonts) {
    assert.ok(entryNames.includes(font), `Missing Workbench font ${font}.`)
  }

  const peerDependencies = packedManifest.peerDependencies as Record<string, unknown> | undefined
  assert.ok(peerDependencies && typeof peerDependencies == 'object', 'Missing packed peer dependencies.')
  const effectPeer = peerDependencies.effect
  assert.ok(typeof effectPeer == 'string' && effectPeer.length > 0, 'Missing packed Effect peer version.')
  // Never return entries, decompressed bytes, CSS, or the full packed manifest.
  return { effectPeer }

  function readPackedText(file: string): string {
    const packedFile = entries.find((entry) => entry.header.name == `package/${file}`)
    assert.ok(packedFile?.data, `Missing npm package file ${file}.`)
    return new TextDecoder().decode(packedFile.data)
  }

  function verifyExportTargets(target: unknown): void {
    if (typeof target == 'string') {
      assert.ok(target.startsWith('./'), `Package target must be relative: ${target}`)
      assert.ok(entryNames.includes(`package/${target.slice(2)}`), `Missing npm package target ${target}.`)
      return
    }
    assert.ok(target && typeof target == 'object', 'Expected an export target or condition map.')
    for (const value of Object.values(target)) verifyExportTargets(value)
  }
}
