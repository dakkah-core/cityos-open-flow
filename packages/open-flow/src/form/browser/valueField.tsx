import type { FieldValueEditorProps } from './fieldValueEditor.tsx'

import { useTranslate } from 'val-i18n-react'
import { Input } from '../../ui/browser/input.tsx'
import { EditorComponentIcon } from './editorComponentIcon.tsx'
import { FieldName } from './fieldName.tsx'
import { FieldNullable } from './fieldTable.tsx'
import { FieldTypeDisplay, useFieldTypePresentation } from './fieldTypeDisplay.tsx'
import { FieldValueEditor } from './fieldValueEditor.tsx'

/** A schema-defined field edits values only; its name, type and nullability stay fixed. */
export function ValueField(props: Omit<FieldValueEditorProps, 'header' | 'layout' | 'trailingControl' | 'onDefinitionChange'>) {
  const t = useTranslate()
  const { component, label } = useFieldTypePresentation(props.schema)
  return (
    <FieldValueEditor
      {...props}
      layout="ports"
      header={
        <>
          <FieldName name={props.label} description={props.description}>
            <Input aria-label={t('valueEditor.fieldName')} value={props.label} readOnly />
          </FieldName>
          <span data-field-type>
            <FieldTypeDisplay
              label={label}
              accessibleLabel={`${t('valueEditor.type', { name: props.label })}: ${label}`}
              icon={<EditorComponentIcon component={component} />}
            />
          </span>
        </>
      }
      trailingControl={<FieldNullable name={props.label} checked={props.nullable === true} />}
    />
  )
}
