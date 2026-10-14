import type { TriggerNode } from '../../flow/common/change.ts'

import { fieldsView } from './authoringFields.ts'

/** Shared business configuration for authoring and published entry inspection. */
export function triggerConfiguration(node: TriggerNode) {
  switch (node.kind) {
    case 'start':
      return { parameters: fieldsView(node.parameters) }
    case 'manual':
      return {}
    case 'webhook':
      return { body: fieldsView(node.bodyFields), method: node.method, ...(node.options == null ? {} : { options: node.options }) }
    case 'cron':
      return { schedule: node.cronTimes }
    case 'error':
      return node.sourceFlowIds == null ? {} : { sourceFlowIds: node.sourceFlowIds }
    case 'poll':
    case 'integration':
      return {
        key: node.definition.key,
        ...(node.connectionId == null ? {} : { connectionId: node.connectionId }),
        ...(node.kind == 'poll' ? { schedule: node.pollTimes } : {}),
      }
  }
}
