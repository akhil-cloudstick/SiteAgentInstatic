/**
 * base.button editor preview component.
 *
 * Component-only file so React Fast Refresh can hot-patch edits without
 * re-running module registration.
 *
 * The label is edited via the Properties panel and inline on the canvas
 * (double-click → the element itself becomes contentEditable; see
 * `inlineEditableElementProps`).
 */
import React from 'react'
import type { ModuleComponentProps } from '@core/module-engine'
import { anchorRel } from '@modules/base/shared/anchorTarget'
import { htmlAttributesForReact } from '@modules/base/shared/htmlAttributes'
import { inlineEditableElementProps } from '@modules/base/shared/inlineText'
import { resolveButtonAnchor } from './anchor'
import type { ButtonStoredProps } from './props'

export const ButtonEditor: React.FC<ModuleComponentProps<ButtonStoredProps>> = ({
  props,
  children,
  mcClassName,
  nodeWrapperProps,
  inlineEdit,
}) => {
  const htmlAttrs = htmlAttributesForReact(props.htmlAttributes)
  const anchor = resolveButtonAnchor(props.href)
  // A button with child nodes (e.g. an imported icon `<svg>`) renders those
  // children — matching the publisher (`button/index.ts`). Only a childless
  // button falls back to the text label. Without this, icon-only buttons
  // (nav search/account/cart) rendered the placeholder string "Button" on the
  // canvas while the published output was correct.
  const hasChildren = React.Children.count(children) > 0
  const content = inlineEdit ? undefined : hasChildren ? children : props.label || 'Button'
  // React.createElement (not JSX) so the editable element's generic
  // `Ref<HTMLElement>` is accepted — matching TextEditor / LinkEditor.
  if (anchor) {
    return React.createElement(
      'a',
      {
        ...nodeWrapperProps,
        ...htmlAttrs,
        href: anchor.href,
        target: props.target,
        rel: anchorRel(props.target) ?? undefined,
        className: mcClassName,
        ...(inlineEdit ? inlineEditableElementProps(inlineEdit) : {}),
      },
      content,
    )
  }
  return React.createElement(
    'button',
    {
      ...nodeWrapperProps,
      ...htmlAttrs,
      type: 'button',
      className: mcClassName,
      // A disabled button can't be focused/edited — never disable while editing.
      disabled: inlineEdit ? undefined : props.disabled,
      ...(inlineEdit ? inlineEditableElementProps(inlineEdit) : {}),
    },
    content,
  )
}
