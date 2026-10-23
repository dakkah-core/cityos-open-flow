import path from 'node:path'

export interface BundleDiagnostic {
  readonly code: string
  readonly message: string
  readonly path?: string
}

export class BundleError extends Error {
  public readonly diagnostics: readonly BundleDiagnostic[]

  public constructor(message: string, diagnostics: readonly BundleDiagnostic[]) {
    super(message)
    this.name = 'BundleError'
    this.diagnostics = diagnostics
  }
}

export interface BuildGraphImport {
  readonly external: boolean
  readonly kind: string
  readonly original: string | undefined
  readonly path: string
}

export interface BuildGraphInput {
  readonly id: string
  readonly imports: readonly BuildGraphImport[]
}

export interface BuildGraph {
  readonly inputs: readonly BuildGraphInput[]
}

export interface JavaScriptBundle {
  readonly bytes: Uint8Array
  readonly externalImports: readonly string[]
  readonly graph: BuildGraph
  readonly resolvedInputPaths: readonly string[]
}

export interface JavaScriptBuildConfig {
  readonly allowUnresolved?: readonly string[] | undefined
  readonly conditions?: readonly string[] | string | undefined
  readonly define?: Readonly<Record<string, string>> | undefined
  readonly entrypoints: readonly string[]
  readonly env?: 'disable' | 'inline' | `${string}*` | undefined
  readonly external?: readonly string[] | undefined
  readonly files?: Readonly<Record<string, string | Blob | NodeJS.TypedArray | ArrayBufferLike>> | undefined
  readonly format?: 'cjs' | 'esm' | 'iife' | undefined
  readonly minify?: boolean | Readonly<{ identifiers?: boolean; syntax?: boolean; whitespace?: boolean }> | undefined
  readonly plugins?: readonly unknown[] | undefined
  readonly root?: string | undefined
  readonly splitting?: boolean | undefined
  readonly target?: 'browser' | 'bun' | 'node' | undefined
}

export interface JavaScriptBuildOptions {
  readonly diagnosticCode?: string
  readonly diagnosticPath?: string
  readonly failureMessage?: string
  readonly onWarning?: ((message: string) => void) | undefined
  readonly projectRoot: string
}

export async function buildJavaScriptBundle(config: JavaScriptBuildConfig, options: JavaScriptBuildOptions): Promise<JavaScriptBundle> {
  let result: BunBuildOutput
  let Transpiler: BunTranspilerConstructor
  try {
    const bun = Reflect.get(globalThis, 'Bun')
    const build = bun != null && typeof bun == 'object' ? Reflect.get(bun, 'build') : undefined
    Transpiler = bun != null && typeof bun == 'object' ? Reflect.get(bun, 'Transpiler') : undefined
    if (typeof build != 'function' || typeof Transpiler != 'function') throw new TypeError('Bun build APIs are unavailable.')
    result = (await Reflect.apply(build, bun, [{ ...config, metafile: true, throw: false }])) as BunBuildOutput
  } catch (error) {
    throw buildFailure(options, error instanceof Error ? error.message : String(error))
  }
  requireSuccessfulBuild(result, options)
  const output = requireSingleJavaScriptEntry(result, options)
  if (result.metafile == null) throw buildFailure(options, 'Bun did not return build metadata.')
  const { graph, resolvedInputPaths } = normalizeBuildGraph(result.metafile, options.projectRoot)
  const bytes = Uint8Array.from(new Uint8Array(await output.arrayBuffer()))
  return {
    bytes,
    externalImports: new Transpiler()
      .scan(new TextDecoder().decode(bytes))
      .imports.map((imported) => imported.path)
      .toSorted(compareText),
    graph,
    resolvedInputPaths,
  }
}

function requireSuccessfulBuild(result: BunBuildOutput, options: JavaScriptBuildOptions): void {
  for (const log of result.logs) {
    if (log.level == 'warning') options.onWarning?.(formatBuildLog(log, options.projectRoot))
  }
  if (result.success) return
  const diagnostics = result.logs
    .filter((log) => log.level == 'error')
    .map((log) =>
      bundleDiagnostic(
        options.diagnosticCode ?? 'bundle.build-failed',
        log.message,
        buildLogPath(log, options.projectRoot, options.diagnosticPath ?? '#/build'),
      ),
    )
  if (diagnostics.length > 0) throw new BundleError(options.failureMessage ?? 'JavaScript bundle build failed.', diagnostics)
  throw buildFailure(options, 'Bun reported an unsuccessful build without an error log.')
}

function requireSingleJavaScriptEntry(result: BunBuildOutput, options: JavaScriptBuildOptions): BunBuildArtifact {
  const output = result.outputs[0]
  if (result.outputs.length != 1 || output == null || output.kind != 'entry-point' || !['js', 'jsx', 'ts', 'tsx'].includes(output.loader)) {
    throw buildFailure(options, 'Bun did not produce exactly one JavaScript entry output.')
  }
  return output
}

function normalizeBuildGraph(metafile: BunBuildMetafile, projectRoot: string): Pick<JavaScriptBundle, 'graph' | 'resolvedInputPaths'> {
  const rootPath = path.resolve(projectRoot)
  const resolvedInputPaths = new Set<string>()
  const inputIds = new Map(Object.keys(metafile.inputs).map((inputPath) => [inputPath, normalizeBuildPath(inputPath, rootPath)]))
  const knownInputIds = new Set(inputIds.values())
  const inputs = Object.entries(metafile.inputs)
    .map(([inputPath, input]): BuildGraphInput => {
      const resolvedPath = resolveBuildPath(inputPath)
      if (resolvedPath != null) resolvedInputPaths.add(resolvedPath)
      return {
        id: inputIds.get(inputPath)!,
        imports: input.imports
          .map((imported): BuildGraphImport => ({
            external: imported.external ?? false,
            kind: imported.kind,
            original: imported.original,
            path: imported.external ? imported.path : normalizeImportedPath(imported.path, rootPath, knownInputIds),
          }))
          .toSorted(compareBuildGraphImports),
      }
    })
    .toSorted((left, right) => compareText(left.id, right.id))
  return {
    graph: { inputs },
    resolvedInputPaths: [...resolvedInputPaths].toSorted(compareText),
  }
}

function normalizeImportedPath(value: string, projectRoot: string, knownInputIds: ReadonlySet<string>): string {
  const direct = toPosixPath(value)
  if (knownInputIds.has(direct)) return direct
  const normalized = normalizeBuildPath(value, projectRoot)
  if (knownInputIds.has(normalized)) return normalized
  const matches = [...knownInputIds].filter((inputId) => direct.endsWith(`/${inputId}`) || inputId.endsWith(`/${direct}`))
  return matches.length == 1 ? matches[0]! : normalized
}

function resolveBuildPath(value: string): string | undefined {
  if (path.isAbsolute(value)) return path.normalize(value)
  if (hasScheme(value)) return undefined
  return path.resolve(value)
}

function normalizeBuildPath(value: string, projectRoot: string): string {
  const resolvedPath = resolveBuildPath(value)
  if (resolvedPath == null) return value
  const relativePath = path.relative(projectRoot, resolvedPath)
  return toPosixPath(relativePath.length == 0 ? '.' : relativePath)
}

function hasScheme(value: string): boolean {
  return /^[A-Za-z][A-Za-z\d+.-]*:/.test(value)
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/')
}

function compareBuildGraphImports(left: BuildGraphImport, right: BuildGraphImport): number {
  return (
    compareText(left.path, right.path) ||
    compareText(left.kind, right.kind) ||
    compareText(left.original ?? '', right.original ?? '') ||
    Number(left.external) - Number(right.external)
  )
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function formatBuildLog(log: BunBuildLog, projectRoot: string): string {
  const fallback = '#/build'
  return `${buildLogPath(log, projectRoot, fallback)}: ${log.message}`
}

function buildLogPath(log: BunBuildLog, projectRoot: string, fallback: string): string {
  if (log.position == null) return fallback
  const filePath = normalizeBuildPath(log.position.file, path.resolve(projectRoot))
  return `${filePath}:${log.position.line}:${log.position.column}`
}

function bundleDiagnostic(code: string, message: string, diagnosticPath?: string): BundleDiagnostic {
  return { code, message, path: diagnosticPath }
}

function buildFailure(options: JavaScriptBuildOptions, detail: string): BundleError {
  const message = options.failureMessage ?? 'JavaScript bundle build failed.'
  return new BundleError(message, [bundleDiagnostic(options.diagnosticCode ?? 'bundle.build-failed', detail, options.diagnosticPath ?? '#/build')])
}

interface BunBuildArtifact extends Blob {
  readonly kind: 'asset' | 'bytecode' | 'chunk' | 'entry-point' | 'sourcemap'
  readonly loader: string
}

interface BunBuildLog {
  readonly level: 'debug' | 'error' | 'info' | 'verbose' | 'warning'
  readonly message: string
  readonly position: {
    readonly column: number
    readonly file: string
    readonly line: number
  } | null
}

interface BunBuildMetafile {
  readonly inputs: Readonly<
    Record<
      string,
      {
        readonly imports: readonly {
          readonly external?: boolean | undefined
          readonly kind: string
          readonly original?: string | undefined
          readonly path: string
        }[]
      }
    >
  >
}

interface BunTranspilerConstructor {
  new (): {
    scan(source: string): {
      readonly imports: readonly {
        readonly path: string
      }[]
    }
  }
}

interface BunBuildOutput {
  readonly logs: readonly BunBuildLog[]
  readonly metafile?: BunBuildMetafile | undefined
  readonly outputs: readonly BunBuildArtifact[]
  readonly success: boolean
}
