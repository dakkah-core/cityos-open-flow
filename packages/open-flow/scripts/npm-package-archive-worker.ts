import assert from 'node:assert/strict'
import { assertArchiveBun } from './npm-package-archive-process.ts'
import { verifyNpmPackageArchive } from './npm-package-archive.ts'

try {
  await assertArchiveBun()
  const [tarballPath, version] = process.argv.slice(2)
  assert.ok(tarballPath && version && process.argv.length == 4, 'Expected archive path and package version.')
  const facts = await verifyNpmPackageArchive(tarballPath, version)
  process.stdout.write(`${JSON.stringify(facts)}\n`)
} catch (error) {
  // Keep diagnostics finite; the parent independently bounds both child pipes.
  const diagnostic = error instanceof Error ? (error.stack ?? error.message) : String(error)
  process.stderr.write(Buffer.from(diagnostic).subarray(0, 16 * 1024))
  process.exitCode = 1
}
