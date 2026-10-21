import type { InputSourceCandidate } from '../../../../flow/common/graph.ts'

import { describe, expect, it } from 'vitest'
import { integrationDefinitions, pollDefinitions } from '../../../../trigger/providers/definitions.ts'
import { localizeTrigger } from '../../../../trigger/providers/localization.ts'
import {
  presentProviderOutputDescription,
  presentProviderSourceCandidates,
  presentProviderTriggerConfig,
  presentProviderTriggerOutputs,
} from './providerTriggerPresentation.ts'

const githubRepoEvent = integrationDefinitions.find((item) => item.snapshot.key === 'github.on_repo_event')!
const trigger = {
  config: {},
  definition: githubRepoEvent.snapshot,
  kind: 'integration',
  name: 'Repository Event',
} as const

describe('Provider Trigger presentation', () => {
  it('localizes Provider-declared groups without changing their layout or field values', () => {
    const definition = pollDefinitions.find((item) => item.snapshot.key === 'gmail.on_message_received')!.snapshot
    const before = structuredClone(definition)
    const inputs = presentProviderTriggerConfig(definition.configInputs, undefined, { 'Advanced settings': '高级设置' })
    const group = inputs.findIndex((input) => 'group' in input)

    expect(inputs.slice(0, group).map((input) => 'handle' in input && input.handle)).toEqual(['labelNamesOrIds', 'readStatus', 'search', 'sender'])
    expect(inputs[group]).toEqual({ group: '高级设置', collapsed: true })
    expect(inputs.slice(group + 1).map((input) => 'handle' in input && input.handle)).toEqual(['includeDrafts', 'includeSpamAndTrash', 'maxMessagesPerPoll'])
    expect(inputs.filter((input) => 'handle' in input)).toEqual(definition.configInputs.filter((input) => 'handle' in input))
    expect(definition.configInputs[group]).toEqual({ group: 'Advanced settings', collapsed: true })
    expect(definition).toEqual(before)
  })

  it('preserves custom groups without introducing an inferred layout', () => {
    const inputs = [
      { handle: 'insecureSsl', jsonSchema: { type: 'boolean' }, nullable: false, value: false },
      { group: 'Delivery', collapsed: false },
      { handle: 'delivery', jsonSchema: { type: 'string' }, nullable: false },
    ] as const
    expect(presentProviderTriggerConfig(inputs, undefined, { 'Advanced settings': '高级设置' })).toEqual(inputs)
    expect(presentProviderTriggerConfig(inputs)).toBe(inputs)
  })

  it('localizes configuration and output descriptions without changing runtime definitions', async () => {
    const display = await localizeTrigger(trigger.definition, 'zh-CN')
    const config = presentProviderTriggerConfig(trigger.definition.configInputs, display)
    const outputs = presentProviderTriggerOutputs(trigger, display)
    const presentedOwner = config.find((field) => 'handle' in field && field.handle == 'owner')
    const runtimeOwner = trigger.definition.configInputs.find((field) => 'handle' in field && field.handle == 'owner')

    expect(presentedOwner != null && 'handle' in presentedOwner ? presentedOwner.description : undefined).toBe(display.configInputs.owner)
    expect(outputs.find((field) => field.handle == 'body')?.description).toBe(display.outputs.body)
    expect(display.configInputs.owner).not.toBe('Owner of the GitHub repository.')
    expect(runtimeOwner != null && 'handle' in runtimeOwner ? runtimeOwner.description : undefined).toBeUndefined()
    expect(trigger.definition.outputs.find((field) => field.handle == 'body')?.description).toBeUndefined()
  })

  it('presents localized output descriptions in source choices', async () => {
    const display = await localizeTrigger(trigger.definition, 'fr')
    const candidates: readonly InputSourceCandidate[] = [{ output: 'body', check: { kind: 'available' } }]
    const presented = presentProviderSourceCandidates(trigger, candidates, display)

    expect(presented[0]?.description).toBe(display.outputs.body)
    expect(presentProviderOutputDescription(trigger, 'body', undefined, display)).toBe(display.outputs.body)
    expect(candidates[0]?.description).toBeUndefined()
  })
})
