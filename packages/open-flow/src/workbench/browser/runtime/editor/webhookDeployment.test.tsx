import type { WebhookDeploymentProps } from './webhookDeployment.tsx'

import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { expect, it } from 'vitest'
import { createI18n } from '../i18n.ts'
import { WebhookDeployment } from './webhookDeployment.tsx'

const props: WebhookDeploymentProps = {
  notify: () => {},
  binding: {
    flowId: 'flow',
    triggerNodeId: 'webhook',
    kind: 'webhook',
    currentPublicationId: 'publication',
    endpointUrl: 'https://example.com/webhooks/live',
    health: 'healthy',
    runtimeVersion: 1,
    updatedAt: '2026-10-12T00:00:00Z',
    version: 1,
  },
  status: 'loaded',
  enabled: true,
  hasUnpublishedChanges: false,
  onRetry: () => {},
}

it.each([
  { patch: {}, label: 'Active', copy: true },
  { patch: { enabled: false }, label: 'Suspended', copy: true },
  { patch: { hasUnpublishedChanges: true }, label: 'Draft changes are not live yet.', copy: true },
  { patch: { binding: undefined }, label: 'Publish this flow', copy: false },
  { patch: { binding: { ...props.binding!, currentPublicationId: undefined } }, label: 'Publish this flow', copy: false },
  { patch: { status: 'loading' as const }, label: 'Loading Trigger details', copy: false },
  { patch: { status: 'failed' as const }, label: 'Could not load', copy: false },
])('shows $label and only copies a current, loaded deployment', ({ patch, label, copy }) => {
  const i18n = createI18n('en')
  try {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={i18n}>
        <WebhookDeployment {...props} {...patch} />
      </I18nProvider>,
    )
    expect(markup).toContain(label)
    expect(markup.includes(props.binding!.endpointUrl!)).toBe(copy)
    expect(markup.includes('Copy URL')).toBe(copy)
  } finally {
    i18n.dispose()
  }
})
