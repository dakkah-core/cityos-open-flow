import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { expect, it, vi } from 'vitest'
import { createI18n } from '../../workbench/browser/runtime/i18n.ts'
import { EditorComponentSelect, InlineEditorComponentDisplay } from './editorComponentSelect.tsx'
import { ValueField } from './valueField.tsx'

it.each(['choice', '', 0, false, null, { kind: 'choice' }, ['a', 'b']])('identifies the constant and its exact value: %j', (value) => {
  const markup = renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <EditorComponentSelect schema={{ const: value }} name="result" compact={false} readOnly onChange={vi.fn()} />
      <InlineEditorComponentDisplay schema={{ const: value }} name="inline" />
      <ValueField schema={{ const: value }} label="fixed" value={value} path="/fixed" onDraftIssue={vi.fn()} onChange={vi.fn()} />
    </I18nProvider>,
  )
  const escapedValue = JSON.stringify(value).replaceAll('"', '&quot;')
  expect(markup).toContain(`result type: Constant ${escapedValue}`)
  expect(markup).toContain(`inline type: Constant ${escapedValue}`)
  expect(markup).toContain(`fixed type: Constant ${escapedValue}`)
  expect(markup).not.toContain('type: JSON')
})
