import tailwindcss from '@tailwindcss/vite'
import UnoCSS from '@unocss/vite'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build, esmExternalRequirePlugin, normalizePath } from 'vite'
import { generateScopedName } from '../../build/node/cssModules.ts'
import designerUnoConfig from '../../build/node/designerUnoConfig.ts'
import { providerIconsPlugin } from '../../build/node/providerIcons.ts'
import { twemojiCollectionPlugin } from '../../build/node/twemojiCollection.ts'
import {
  type BuildBrowserRuntimeOptions,
  eventSourceEntryPath,
  integrationTriggerEntryPath,
  pollTriggerEntryPath,
  previewEntryPath,
  providerTriggersEntryPath,
  workbenchEntryPath,
} from './browserPackageRuntime.ts'

const [sourceRoot, outputPath, entryPath, outputName, emptyOutDir, quiet] = process.argv.slice(2)
if (
  sourceRoot == null ||
  outputPath == null ||
  entryPath == null ||
  outputName == null ||
  (emptyOutDir != 'true' && emptyOutDir != 'false') ||
  (quiet != 'true' && quiet != 'false')
) {
  throw new Error('Browser runtime build requires sourceRoot, outputPath, entryPath, outputName, emptyOutDir and quiet.')
}
await buildRuntime({ sourceRoot, quiet: quiet == 'true' }, outputPath, entryPath, outputName, emptyOutDir == 'true')

async function buildRuntime(
  options: BuildBrowserRuntimeOptions,
  outputPath: string,
  entryPath: string,
  outputName: string,
  emptyOutDir: boolean,
): Promise<void> {
  const sharedTriggerPaths = new Map([
    [normalizePath(path.join(options.sourceRoot, integrationTriggerEntryPath)), './integration-trigger.js'],
    [normalizePath(path.join(options.sourceRoot, pollTriggerEntryPath)), './poll-trigger.js'],
  ])
  await build({
    build: {
      emptyOutDir,
      lib: {
        cssFileName: outputName,
        entry: path.join(options.sourceRoot, entryPath),
        fileName: outputName,
        formats: ['es'],
      },
      license: { fileName: 'licenses.md' },
      // Let consumers minify: pre-minified loop declarations can break Rollup when shared chunks are re-bundled.
      minify: false,
      outDir: outputPath,
      rolldownOptions: {
        external: entryPath == providerTriggersEntryPath || entryPath == eventSourceEntryPath ? [...sharedTriggerPaths.keys()] : undefined,
        output: {
          assetFileNames: '[name][extname]',
          entryFileNames: `${outputName}.js`,
          paths: entryPath == providerTriggersEntryPath || entryPath == eventSourceEntryPath ? Object.fromEntries(sharedTriggerPaths) : undefined,
        },
      },
    },
    configFile: false,
    css: { modules: { generateScopedName } },
    define: { 'process.env': '{}' },
    logLevel: options.quiet ? 'silent' : 'info',
    plugins: [
      esmExternalRequirePlugin({ external: [/^effect(?:\/.*)?$/, /^react(?:\/.*)?$/, /^react-dom(?:\/.*)?$/] }),
      providerIconsPlugin(),
      twemojiCollectionPlugin(),
      tailwindcss(),
      UnoCSS(designerUnoConfig),
    ],
    root: options.sourceRoot,
  })
  if (entryPath == workbenchEntryPath || entryPath == previewEntryPath) await extractFonts(path.join(outputPath, `${outputName}.css`), outputPath)
}

async function extractFonts(cssPath: string, outputPath: string): Promise<void> {
  const fonts = new Map<string, Buffer>()
  const css = (await readFile(cssPath, 'utf8')).replaceAll(
    /data:font\/(woff2|woff|ttf);base64,([A-Za-z\d+/=]+)/g,
    (_match: string, format: string, encoded: string) => {
      const bytes = Buffer.from(encoded, 'base64')
      const file = `font-${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.${format}`
      fonts.set(file, bytes)
      return `./assets/${file}`
    },
  )
  if (fonts.size == 0) return
  const assetsPath = path.join(outputPath, 'assets')
  await mkdir(assetsPath, { recursive: true })
  await Promise.all([...fonts].map(([file, bytes]) => writeFile(path.join(assetsPath, file), bytes)))
  await writeFile(cssPath, css)
}
