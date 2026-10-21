import type { SetNotice } from '../stores/workbenchNotice.ts'

import { useEffect, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/browser/tooltip.tsx'

export function WebhookCopyButton({
  endpointUrl,
  notify,
  iconOnly = false,
}: {
  readonly endpointUrl: string
  readonly notify: SetNotice
  readonly iconOnly?: boolean
}) {
  const t = useTranslate()
  const [copied, setCopied] = useState(false)
  const [container, setContainer] = useState<HTMLSpanElement | null>(null)
  useEffect(() => {
    if (!copied) return
    const timer = globalThis.setTimeout(() => setCopied(false), 1_500)
    return () => globalThis.clearTimeout(timer)
  }, [copied])
  const label = t(copied ? 'publication.webhookCopied' : 'publication.webhookCopy')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(endpointUrl)
      setCopied(true)
    } catch {
      setCopied(false)
      notify({ kind: 'error', message: t('webhookDeployment.copyFailed') })
    }
  }
  return (
    <span className="inline-flex shrink-0 flex-col gap-2" ref={setContainer}>
      {iconOnly ? (
        <Tooltip>
          <TooltipTrigger render={<Button aria-label={label} size="icon-sm" variant="ghost" onClick={copy} />}>
            <i aria-hidden="true" className={copied ? 'i-lucide-light:check text-base' : 'i-lucide-light:copy text-base'} />
          </TooltipTrigger>
          <TooltipContent container={container} side="bottom" align="end">
            {label}
          </TooltipContent>
        </Tooltip>
      ) : (
        <Button size="sm" variant="outline" onClick={copy}>
          {label}
        </Button>
      )}
      <span className="sr-only" role="status">
        {copied ? label : ''}
      </span>
    </span>
  )
}

export function WebhookEndpoint({ endpointUrl, notify }: { readonly endpointUrl: string; readonly notify: SetNotice }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <code className="min-w-0 flex-1 select-text break-all text-foreground text-xs leading-5">{endpointUrl}</code>
      <WebhookCopyButton notify={notify} key={endpointUrl} endpointUrl={endpointUrl} />
    </div>
  )
}
