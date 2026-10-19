import type { ComponentProps, ElementType, ReactElement, ReactNode } from 'react'

import { Children, isValidElement } from 'react'
import { expect, it, vi } from 'vitest'
import { Select, SelectItem } from '../../ui/browser/select.tsx'
import { EditorComponentSelect } from './editorComponentSelect.tsx'

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: (initial: unknown) => [typeof initial == 'function' ? (initial as () => unknown)() : initial, vi.fn()],
}))

vi.mock('val-i18n-react', () => ({
  useTranslate: () => (key: string) => key,
}))

function isElement<T extends ElementType>(element: unknown, type: T): element is ReactElement<ComponentProps<T>, T> {
  return isValidElement(element) && element.type === type
}

function find<T extends ElementType>(
  element: ReactNode,
  type: T,
  predicate: (item: ReactElement<ComponentProps<T>, T>) => boolean = () => true,
): ReactElement<ComponentProps<T>, T> | undefined {
  if (!isValidElement<{ readonly children?: ReactNode }>(element)) return
  const children = element.props.children
  if (isElement(element, type) && predicate(element)) return element
  for (const child of Children.toArray(children)) {
    const match = find(child, type, predicate)
    if (match != null) return match
  }
}

it('offers Any without a second JSON entry in the complete value-editor menu', () => {
  const onChange = vi.fn()
  const rendered = EditorComponentSelect({ name: 'value', schema: {}, valueOnly: true, addon: true, onChange })
  const select = find(rendered, Select, (item) => typeof item.props.onValueChange == 'function')
  const anyItem = find(rendered, SelectItem, (item) => item.props.value === 'json')

  expect(select?.props.value).toBe('json')
  expect(anyItem?.props.children).toContain('valueEditor.any')
  expect(select?.props.items).toContainEqual({ value: 'text', label: 'valueEditor.components.text' })
  expect(select?.props.items).toContainEqual({ value: 'select', label: 'valueEditor.components.select' })
  expect(select?.props.items).not.toContainEqual({ value: 'json', label: 'valueEditor.components.json' })
  ;(select!.props.onValueChange as (value: string) => void)('text')
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ 'type': 'string', 'ui:widget': 'text' })
})

it('returns to generic JSON editing without retaining editor constraints', () => {
  const onChange = vi.fn()
  const rendered = EditorComponentSelect({ name: 'value', schema: { type: 'string', format: 'date' }, valueOnly: true, onChange })
  const select = find(rendered, Select, (item) => typeof item.props.onValueChange == 'function')
  ;(select!.props.onValueChange as (value: string) => void)('json')
  expect(onChange).toHaveBeenCalledExactlyOnceWith({})
})
