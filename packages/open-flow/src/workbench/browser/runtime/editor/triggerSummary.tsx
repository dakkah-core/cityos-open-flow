import type { TriggerDisplay } from '../../../../control/common/triggerCatalog.ts'
import type { TriggerNode, Port } from '../api.ts'

import { useTranslate } from 'val-i18n-react'
import { presentBuiltInTriggerOutputs } from './builtInOutputPresentation.ts'
import { PortDefinitionEditor } from './portDefinitionEditor.tsx'
import { presentProviderTriggerOutputs } from './providerTriggerPresentation.ts'

export function TriggerSummary({
  trigger,
  display,
  inputDefs,
}: {
  readonly trigger: TriggerNode
  readonly display?: TriggerDisplay
  readonly inputDefs: readonly Port[]
}) {
  const t = useTranslate()
  const values =
    trigger.kind == 'integration' || trigger.kind == 'poll'
      ? presentProviderTriggerOutputs(trigger, display)
      : presentBuiltInTriggerOutputs(trigger, t, inputDefs)
  return (
    <section className="inspector-port-section" data-inspector-section="outputs">
      <PortDefinitionEditor layout="ports" title={t('inspector.ports.outputsTitle')} output disabled values={values} onChange={() => {}} />
    </section>
  )
}
