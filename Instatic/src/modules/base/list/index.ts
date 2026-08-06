/**
 * base.list — ordered or unordered list.
 *
 * Emits a bare `<ul>` / `<ol>` with no default class or default CSS.
 * Visual styling is opt-in via user classes (mcClassName / multi-class system).
 */
import type { ModuleDefinition } from '@core/module-engine'
import { registry } from '@core/module-engine'
import { Value } from '@core/utils/typeboxHelpers'
import { ListBoxSolidIcon } from 'pixel-art-icons/icons/list-box-solid'
import { listUsesChildren, parseItems } from './items'
import { ListEditor } from './ListEditor'
import { ListPropsSchema, type ListStoredProps } from './props'

export const ListModule: ModuleDefinition<ListStoredProps> = {
  id: 'base.list',
  name: 'List',
  description: 'An ordered or unordered list.',
  category: 'Typography',
  version: '2.0.0',
  icon: ListBoxSolidIcon,
  trusted: true,

  // A List holds real child layers so each item is individually selectable,
  // stylable and nestable, like every other container in the tree.
  //
  // The legacy `items` textarea is retained, NOT migrated: every List authored
  // before this change has no children and keeps rendering from `items`, so
  // existing pages are byte-identical. Children win when present — see
  // `listUsesChildren`.
  canHaveChildren: true,

  // A freshly inserted List arrives with three real items rather than an
  // empty <ul>. `tag: 'li'` is what makes the child a valid list item.
  defaultChildren: [
    { moduleId: 'base.text', props: { text: 'List item 1', tag: 'li' } },
    { moduleId: 'base.text', props: { text: 'List item 2', tag: 'li' } },
    { moduleId: 'base.text', props: { text: 'List item 3', tag: 'li' } },
  ],

  schema: {
    items: {
      type: 'textarea',
      label: 'Items',
      rows: 5,
      placeholder: 'Item 1\nItem 2\nItem 3',
    },
    listType: {
      type: 'select',
      label: 'List type',
      options: [
        { label: 'Bullet', value: 'unordered' },
        { label: 'Numbered', value: 'ordered' },
      ],
    },
  },

  propsSchema: ListPropsSchema,
  defaults: Value.Create(ListPropsSchema),

  component: ListEditor,

  htmlTag: (props) => (props.listType === 'ordered' ? 'ol' : 'ul'),

  render: (props, renderedChildren) => {
    const tag = props.listType === 'ordered' ? 'ol' : 'ul'
    // Child layers win; a childless List (i.e. every List authored before this
    // module became a container) still renders from the `items` textarea.
    const inner = listUsesChildren(renderedChildren.length)
      ? renderedChildren.join('')
      : parseItems(String(props.items || ''))
          .map((item) => `<li>${item}</li>`)
          .join('')
    return {
      html: `<${tag}>${inner}</${tag}>`,
    }
  },
}

registry.registerOrReplace(ListModule)
