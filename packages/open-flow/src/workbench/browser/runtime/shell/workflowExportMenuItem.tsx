import { useTranslate } from 'val-i18n-react'
import { DropdownMenuItem } from '../../../../ui/browser/dropdown-menu.tsx'

export function WorkflowExportMenuItem({
  disabled,
  onClick,
  className,
}: {
  readonly disabled: boolean
  readonly onClick: () => void
  readonly className?: string
}) {
  const t = useTranslate()
  return (
    <DropdownMenuItem disabled={disabled} onClick={onClick} className={className}>
      <i aria-hidden="true" className="i-lucide-light:download size-4 shrink-0" />
      {t('resource.exportFlow')}
    </DropdownMenuItem>
  )
}
