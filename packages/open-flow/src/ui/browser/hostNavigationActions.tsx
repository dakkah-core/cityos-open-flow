import type { ReactElement } from 'react'
import type { UiLanguage } from '../../localization/common/languages.ts'

import { useId } from 'react'
import { uiLanguages, uiLanguageNames } from '../../localization/common/languages.ts'
import { Button, buttonVariants } from './button.tsx'
import { HostTooltip } from './hostTooltip.tsx'
import { cn } from './utils.ts'

export type HostThemeMode = 'light' | 'dark' | 'auto'

export interface HostNavigationActionsProps {
  readonly className?: string
  readonly language: UiLanguage
  readonly onLanguageChange: (language: UiLanguage) => void
  readonly theme: HostThemeMode
  readonly onThemeChange: (theme: HostThemeMode) => void
  readonly labels: Readonly<Record<HostThemeMode | 'theme' | 'language', string>>
}

const themeIcons = { light: 'i-lucide-light:sun', dark: 'i-lucide-light:moon', auto: 'i-lucide-light:sun-moon' }
const actionClassName = 'rounded-full bg-foreground/3 text-foreground hover:bg-foreground/7 dark:hover:bg-foreground/7'

/** Shared host navigation; each host owns preference storage and localized labels. */
export function HostNavigationActions({ className, language, onLanguageChange, theme, onThemeChange, labels }: HostNavigationActionsProps): ReactElement {
  const themeId = useId()
  const languageId = useId()
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <HostTooltip label="GitHub" side="bottom">
        <a
          href="https://github.com/oomol-lab/open-flow"
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: 'ghost', size: 'icon', className: actionClassName })}
          aria-label="GitHub"
        >
          <i aria-hidden="true" className="i-lucide-light:github size-4" />
        </a>
      </HostTooltip>
      <HostTooltip label={labels.theme} side="bottom">
        <Button className={actionClassName} variant="ghost" size="icon" type="button" aria-label={labels.theme} {...{ popovertarget: themeId }}>
          <i aria-hidden="true" className={`${themeIcons[theme]} size-4`} />
        </Button>
      </HostTooltip>
      <HostTooltip label={labels.language} side="bottom">
        <Button className={actionClassName} variant="ghost" size="icon" type="button" {...{ popovertarget: languageId }} aria-label={labels.language}>
          <i aria-hidden="true" className="i-lucide-light:languages size-4" />
        </Button>
      </HostTooltip>
      <div id={themeId} {...{ popover: 'auto' }} className="open-flow-navigation-menu">
        {(['light', 'dark', 'auto'] as const).map((value) => (
          <Button
            key={value}
            className="justify-start gap-2"
            variant="ghost"
            size="sm"
            type="button"
            aria-pressed={theme == value}
            onClick={(event) => {
              onThemeChange(value)
              event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover()
            }}
          >
            <i aria-hidden="true" className={`${themeIcons[value]} size-4`} />
            {labels[value]}
          </Button>
        ))}
      </div>
      <div id={languageId} {...{ popover: 'auto' }} className="open-flow-navigation-menu">
        {uiLanguages.map((value) => (
          <Button
            key={value}
            variant="ghost"
            size="sm"
            type="button"
            aria-pressed={language == value}
            onClick={(event) => {
              onLanguageChange(value)
              event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover()
            }}
          >
            {uiLanguageNames[value]}
          </Button>
        ))}
      </div>
    </div>
  )
}
