import type { ArchiveFacts } from './npm-package-archive.ts'

import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const maximumResultBytes = 1024
const maximumDiagnosticBytes = 16 * 1024
const maximumDurationMs = 120_000

export async function assertArchiveBun(): Promise<void> {
  const expected = (await readFile(new URL('../../../.bun-version', import.meta.url), 'utf8')).trim()
  assert.equal(process.versions.bun, expected, `Archive verification requires the owning native Bun ${expected}.`)
}

export async function verifyArchiveInChild(tarballPath: string, version: string): Promise<ArchiveFacts> {
  await assertArchiveBun()
  // The parent must not import the archive implementation or receive archive data.
  const child = spawn(process.execPath, [fileURLToPath(new URL('./npm-package-archive-worker.ts', import.meta.url)), tarballPath, version], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  return await joinArchiveProcess(child)
}

// Export the actual process boundary so regressions can exercise close ordering,
// failed starts, bounded diagnostics and deadline termination without a build.
export function joinArchiveProcess(child: ChildProcess, timeoutMs = maximumDurationMs): Promise<ArchiveFacts> {
  assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= maximumDurationMs, 'Invalid archive verification deadline.')
  return new Promise((resolve, reject) => {
    let stdout = Buffer.alloc(0)
    let stderr = Buffer.alloc(0)
    let failure: Error | undefined
    let terminating = false
    const stop = (error: Error): void => {
      failure ??= error
      if (terminating) return
      terminating = true
      // Termination requests do not admit install/browser: only close settles.
      try {
        child.kill('SIGKILL')
      } catch (killError) {
        failure = new Error(`${failure.message}; archive termination failed: ${String(killError)}`)
      }
    }
    const deadline = setTimeout(() => stop(new Error(`Archive verification timed out after ${timeoutMs}ms.`)), timeoutMs)
    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length + chunk.length > maximumResultBytes) {
        stop(new Error(`Archive verification result exceeds ${maximumResultBytes} bytes.`))
      } else if (!failure) stdout = Buffer.concat([stdout, chunk])
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      const remaining = maximumDiagnosticBytes - stderr.length
      if (remaining > 0) stderr = Buffer.concat([stderr, chunk.subarray(0, remaining)])
      if (chunk.length > remaining) stop(new Error(`Archive verification diagnostics exceed ${maximumDiagnosticBytes} bytes.`))
    })
    child.stdout?.once('error', stop)
    child.stderr?.once('error', stop)
    child.once('error', (error) => {
      failure ??= error
    })
    child.once('close', (code, signal) => {
      clearTimeout(deadline)
      try {
        if (failure) throw failure
        assert.equal(code, 0, `Archive verification failed: code=${code}, signal=${signal}.`)
        assert.equal(signal, null, `Archive verification terminated by ${signal}.`)
        const result: unknown = JSON.parse(stdout.toString('utf8'))
        assert.ok(result && typeof result == 'object' && !Array.isArray(result), 'Invalid archive verification result.')
        assert.deepEqual(Object.keys(result), ['effectPeer'], 'Archive worker must return only the consumer peer version.')
        const effectPeer: unknown = Reflect.get(result, 'effectPeer')
        assert.ok(typeof effectPeer == 'string' && effectPeer.length > 0, 'Invalid archive Effect peer version.')
        resolve({ effectPeer })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        reject(new Error(`${message}${stderr.length ? `\n${stderr.toString('utf8')}` : ''}`))
      }
    })
  })
}
