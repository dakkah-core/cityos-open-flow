import type { ReactNode } from 'react'
import type { InspectorSection } from './diagnostics.ts'

export function InspectorStatusSection({
  title,
  actions,
  children,
  tone = 'neutral',
  section,
  alert = false,
}: {
  readonly title: ReactNode
  readonly actions?: ReactNode
  readonly children: ReactNode
  readonly tone?: 'neutral' | 'warning' | 'danger'
  readonly section: InspectorSection
  readonly alert?: boolean
}) {
  return (
    <section className="inspector-status" data-tone={tone} data-inspector-section={section} role={alert ? 'alert' : undefined}>
      <h3 className="inspector-section-title">
        {title}
        {actions}
      </h3>
      <div className="inspector-status-content">{children}</div>
    </section>
  )
}
