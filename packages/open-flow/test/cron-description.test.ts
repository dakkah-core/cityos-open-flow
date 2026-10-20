import { describe, expect, it } from 'vitest'
import { uiLanguages } from '../src/localization/common/languages.ts'
import { cronDescription } from '../src/trigger/browser/cronDescription.ts'

describe('catalog-installed cron description consumer', () => {
  const expression = '30 9 * * MON-FRI'

  it('describes a valid schedule through the actual formatter', () => {
    const description = cronDescription(expression, 'en')
    expect(description).not.toBe(expression)
    expect(description.trim().length).toBeGreaterThan(0)
    expect(description).toContain('09:30')
  })

  it('registers the translations for every supported product language', () => {
    const english = cronDescription(expression, 'en')
    for (const language of uiLanguages.filter((language) => language !== 'en')) {
      const description = cronDescription(expression, language)
      expect(description, language).not.toBe(expression)
      expect(description.trim().length, language).toBeGreaterThan(0)
      expect(description, language).not.toBe(english)
    }
  })

  it('uses the product language resolver for regional tags', () => {
    expect(cronDescription(expression, 'fr-CA')).toBe(cronDescription(expression, 'fr'))
    expect(cronDescription(expression, 'zh-Hant-TW')).toBe(cronDescription(expression, 'zh-TW'))
  })

  it('keeps unsupported or invalid schedules directly inspectable', () => {
    for (const value of ['invalid cron', '0 0 9 * * *', '0 99 * * *', '0 12 L * FRI', '0 12 * * MON+FRI']) {
      for (const language of uiLanguages) expect(cronDescription(value, language)).toBe(value)
    }
  })
})
