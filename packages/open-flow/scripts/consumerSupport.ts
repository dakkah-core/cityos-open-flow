import { existsSync, lstatSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

interface Catalogs {
  readonly catalog?: Readonly<Record<string, string>>
  readonly catalogs?: Readonly<Record<string, Readonly<Record<string, string>>>>
}

// Isolated consumers have no workspace catalog. Resolve from the owning manifest
// before writing their package.json, rather than depending on ambient versions.
export function consumerDependency(workspace: Catalogs, name: string, requested: string): string {
  const selected = requested?.startsWith('catalog:')
    ? (requested === 'catalog:' ? workspace.catalog : workspace.catalogs?.[requested.slice('catalog:'.length)])?.[name]
    : requested
  if (typeof selected !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(selected)) {
    throw Error(`Isolated consumer requires an exact catalog version for ${name}; received ${String(selected)}.`)
  }
  return selected
}

export function assertTemporaryConsumerTarget(directory: string, target = directory): void {
  const temporaryRoot = realpathSync(tmpdir())
  const absolute = path.resolve(directory)
  if (path.dirname(absolute) !== temporaryRoot || !path.basename(absolute).startsWith('open-flow-consumer-') || lstatSync(absolute).isSymbolicLink()) {
    throw Error(`Refusing cleanup outside an owned temporary consumer: ${directory}`)
  }
  const root = realpathSync(absolute)
  const absoluteTarget = path.resolve(target)
  const relative = path.relative(root, absoluteTarget)
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw Error(`Refusing consumer cleanup outside ${directory}`)
  }
  if (existsSync(absoluteTarget)) {
    const resolved = path.relative(root, realpathSync(absoluteTarget))
    if (path.isAbsolute(resolved) || resolved === '..' || resolved.startsWith(`..${path.sep}`) || lstatSync(absoluteTarget).isSymbolicLink()) {
      throw Error(`Refusing linked consumer cleanup: ${target}`)
    }
  }
}
