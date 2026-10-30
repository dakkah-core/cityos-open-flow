import { EventEmitter } from 'node:events'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildRuntime } from '../src/distribution/node/browserPackageRuntime.ts'

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn }))

const sourceRoot = path.resolve('source with spaces')
const outputPath = path.join(sourceRoot, 'dist/npm-package/package/dist/browser')

let child: EventEmitter
beforeEach(() => {
  child = new EventEmitter()
  spawn.mockReset().mockReturnValue(child)
})

describe('Browser package runtime process lifetime', () => {
  it.each([
    { emptyOutDir: true, quiet: true },
    { emptyOutDir: false, quiet: false },
  ])('uses the selected runtime and forwards entry settings %o', async ({ emptyOutDir, quiet }) => {
    const pending = buildRuntime({ sourceRoot, quiet }, outputPath, 'src/distribution/browser/preview.ts', 'preview', emptyOutDir)

    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      [
        path.resolve(import.meta.dirname, '../src/distribution/node/browserPackageRuntimeWorker.ts'),
        sourceRoot,
        outputPath,
        'src/distribution/browser/preview.ts',
        'preview',
        String(emptyOutDir),
        String(quiet),
      ],
      { cwd: sourceRoot, stdio: 'inherit', windowsHide: true },
    )
    child.emit('close', 0, null)
    await pending
  })

  it('starts a fresh process for the next entry only after the previous process closes', async () => {
    const nextChild = new EventEmitter()
    spawn.mockReturnValueOnce(child).mockReturnValueOnce(nextChild)
    const pending = buildRuntime({ sourceRoot, quiet: true }, outputPath, 'src/distribution/browser/preview.ts', 'preview', false).then(() =>
      buildRuntime({ sourceRoot, quiet: true }, outputPath, 'src/distribution/browser/workbench.ts', 'workbench', false),
    )

    child.emit('exit', 0, null)
    await Promise.resolve()
    expect(spawn).toHaveBeenCalledTimes(1)

    child.emit('close', 0, null)
    await Promise.resolve()
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(spawn.mock.calls[1]?.[1]).toEqual([
      path.resolve(import.meta.dirname, '../src/distribution/node/browserPackageRuntimeWorker.ts'),
      sourceRoot,
      outputPath,
      'src/distribution/browser/workbench.ts',
      'workbench',
      'false',
      'true',
    ])
    nextChild.emit('close', 0, null)
    await pending
  })

  it.each([
    { code: 9, signal: null, reason: 'exit code 9' },
    { code: null, signal: 'SIGTERM', reason: 'signal SIGTERM' },
  ])('reports a failed entry and prevents subsequent builds: $reason', async ({ code, signal, reason }) => {
    const pending = buildRuntime({ sourceRoot, quiet: true }, outputPath, 'src/distribution/browser/preview.ts', 'preview', false).then(() =>
      buildRuntime({ sourceRoot, quiet: true }, outputPath, 'src/distribution/browser/workbench.ts', 'workbench', false),
    )
    const rejection = expect(pending).rejects.toThrow(`Browser package entry "preview" failed with ${reason}.`)

    child.emit('close', code, signal)
    await rejection
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('preserves process launch errors', async () => {
    const error = new Error('Selected Bun executable is unavailable')
    const pending = buildRuntime({ sourceRoot, quiet: true }, outputPath, 'src/distribution/browser/preview.ts', 'preview', false)
    const rejection = expect(pending).rejects.toBe(error)

    child.emit('error', error)
    await rejection
    expect(spawn).toHaveBeenCalledTimes(1)
  })
})
