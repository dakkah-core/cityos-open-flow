import type { TFunction } from 'val-i18n'
import type { Group, InputPort } from '../api.ts'

/** Groups Provider inputs for display without changing their saved definitions. */
export function presentConnectorInputs(inputs: readonly (InputPort | Group)[], t: TFunction): readonly (InputPort | Group)[] {
  const required: InputPort[] = []
  const optional: InputPort[] = []
  for (const input of inputs) {
    if ('group' in input) return inputs
    ;(input.nullable ? optional : required).push(input)
  }
  if (required.length === 0 || optional.length === 0) return inputs
  return [{ group: t('inspector.ports.requiredInputs') }, ...required, { group: t('inspector.ports.optionalInputs'), collapsed: true }, ...optional]
}
