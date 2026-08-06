/**
 * base.list editor preview component.
 *
 * Component-only file so React Fast Refresh can hot-patch edits without
 * re-running module registration. Item parsing is shared with the publisher
 * via the `./items` leaf so the canvas and the published list cannot drift.
 */
import React from 'react'
import type { ModuleComponentProps } from '@core/module-engine'
import styles from './list.module.css'
import { listUsesChildren, parseItems } from './items'
import type { ListStoredProps } from './props'

export const ListEditor: React.FC<ModuleComponentProps<ListStoredProps>> = ({ props, children, mcClassName, nodeWrapperProps }) => {
  const Tag = props.listType === 'ordered' ? 'ol' : 'ul'

  // Same three-way decision the publisher makes: child layers, else the
  // legacy `items` textarea, else the placeholder item.
  if (listUsesChildren(React.Children.count(children))) {
    return React.createElement(Tag, { ...nodeWrapperProps, className: mcClassName }, children)
  }

  const items = parseItems(props.items || '')
  return React.createElement(
    Tag,
    { ...nodeWrapperProps, className: mcClassName },
    items.length > 0
      ? items.map((item, i) => React.createElement('li', { key: i }, item))
      : React.createElement('li', { className: styles.placeholder, 'data-instatic-list-placeholder': '' }, 'List item 1'),
  )
}
