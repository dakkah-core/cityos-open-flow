import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory } from './stories.tsx'

import { useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { EditorComponentSelect } from '../../src/form/browser/editorComponentSelect.tsx'
import { editorGroups, schemaForEditor } from '../../src/form/common/editorComponent.ts'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'

function FieldTypes({ dark, language }: { dark: boolean; language: UiLanguage }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [schemas, setSchemas] = useState(() =>
    Object.values(editorGroups)
      .flat()
      .map((type) => ({ type, schema: schemaForEditor(type, {}) })),
  )
  const [constants, setConstants] = useState<Record<string, unknown>[]>(() =>
    ['choice', '', 0, false, null, { kind: 'choice' }, ['a', 'b']].map((value) => ({ const: value })),
  )
  return (
    <I18nProvider i18n={i18n}>
      <div className="open-flow-workbench open-flow-theme p-6" data-theme={dark ? 'dark' : 'light'}>
        <table className="text-left text-xs">
          <thead>
            <tr>
              <th className="p-2 font-normal">Type</th>
              <th className="p-2 font-normal">Editable</th>
              <th className="p-2 font-normal">Fixed / read-only</th>
              <th className="p-2 font-normal">Temporarily disabled</th>
            </tr>
          </thead>
          <tbody>
            {schemas.map(({ type, schema }, index) => (
              <tr key={type}>
                <th className="p-2 font-normal">{type}</th>
                <td className="p-2">
                  <div className="w-14">
                    <EditorComponentSelect
                      schema={schema}
                      name={`Editable ${type}`}
                      onChange={(next) => setSchemas((current) => current.map((entry, i) => (i === index ? { ...entry, schema: next } : entry)))}
                    />
                  </div>
                </td>
                <td className="p-2">
                  <div className="w-8">
                    <EditorComponentSelect schema={schema} name={`Fixed ${type}`} readOnly onChange={() => {}} />
                  </div>
                </td>
                <td className="p-2">
                  <div className="w-14">
                    <EditorComponentSelect schema={schema} name={`Disabled ${type}`} disabled onChange={() => {}} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="mt-6 text-left text-xs">
          <thead>
            <tr>
              <th className="p-2 font-normal">Constant</th>
              <th className="p-2 font-normal">Editable</th>
              <th className="p-2 font-normal">Fixed / read-only</th>
              <th className="p-2 font-normal">Compact / read-only</th>
            </tr>
          </thead>
          <tbody>
            {constants.map((schema, index) => (
              <tr key={`constant-${index}`}>
                <th className="p-2 font-normal">Constant {index + 1}</th>
                <td className="w-52 p-2">
                  <EditorComponentSelect
                    schema={schema}
                    name={`Editable constant ${index}`}
                    compact={false}
                    onChange={(next) => setConstants((current) => current.map((entry, i) => (i === index ? next : entry)))}
                  />
                </td>
                <td className="w-52 p-2">
                  <EditorComponentSelect schema={schema} name={`Fixed constant ${index}`} compact={false} readOnly readOnlySurface onChange={() => {}} />
                </td>
                <td className="p-2">
                  <EditorComponentSelect schema={schema} name={`Compact constant ${index}`} readOnly onChange={() => {}} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </I18nProvider>
  )
}

export const fieldTypesStory: FrontendStory = {
  id: 'field-type-states',
  title: 'Type States',
  description: 'Editable, fixed, and temporarily disabled types, plus constants with string, empty, falsy, null, and structured values.',
  group: 'Node Fixed Values',
  propertyPanel: true,
  standalone: true,
  render: (_log, dark, language) => <FieldTypes dark={dark} language={language} />,
}
