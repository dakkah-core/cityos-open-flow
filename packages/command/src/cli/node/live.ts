import type { LiveDetails } from '@oomol-lab/open-flow/control-api'

export function liveText(live: LiveDetails): string {
  if (live.publication == null) return `not-published\t${live.flowId}`
  return [
    `live\t${live.flowId}\t${live.publication.publicationId}\t${live.publication.revisionId}\t${live.status}\tenabled=${live.enabled}`,
    `inputDefs=${JSON.stringify(live.inputDefs)}`,
    ...live.entries.flatMap((entry) => [
      `${entry.type}\t${entry.nodeId}\t${entry.name}`,
      ...('binding' in entry
        ? [
            `  health=${entry.binding.health}${entry.binding.lastErrorCode == null ? '' : `\terror=${entry.binding.lastErrorCode}`}`,
            ...(entry.binding.listener == null ? [] : [`  listener=${JSON.stringify(entry.binding.listener)}`]),
            ...(entry.binding.endpointUrl == null ? [] : [`  url=${entry.binding.endpointUrl}`]),
          ]
        : []),
      ...('provider' in entry ? [`  provider=${entry.provider}\tinputs=${JSON.stringify(entry.inputs)}`] : []),
      `  config=${JSON.stringify(entry.config)}`,
    ]),
  ].join('\n')
}
