import { spawn } from 'node:child_process'
import path from 'node:path'

export const eventSourceEntryPath = 'src/event-source/common/index.ts'
export const integrationTriggerEntryPath = 'src/trigger/common/integration.ts'
export const pollTriggerEntryPath = 'src/trigger/common/poll.ts'
export const providerTriggersEntryPath = 'src/trigger/providers/definitions.ts'
export const previewEntryPath = 'src/distribution/browser/preview.ts'
export const workbenchEntryPath = 'src/distribution/browser/workbench.ts'

export interface BuildBrowserRuntimeOptions {
  readonly quiet: boolean
  readonly sourceRoot: string
}

/** Release each bundler's native and JS arenas before the next entry or declaration compiler. */
export function buildRuntime(
  options: BuildBrowserRuntimeOptions,
  outputPath: string,
  entryPath: string,
  outputName: string,
  emptyOutDir: boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.join(import.meta.dirname, 'browserPackageRuntimeWorker.ts'),
        options.sourceRoot,
        outputPath,
        entryPath,
        outputName,
        String(emptyOutDir),
        String(options.quiet),
      ],
      { cwd: options.sourceRoot, stdio: 'inherit', windowsHide: true },
    )
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code == 0 && signal == null) {
        resolve()
        return
      }
      const reason = signal == null ? `exit code ${String(code)}` : `signal ${signal}`
      reject(new Error(`Browser package entry "${outputName}" failed with ${reason}.`))
    })
  })
}
