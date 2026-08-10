import type { IconComponent } from 'pixel-art-icons/types'
import type { DataFieldType } from '@core/data/schemas'

import { BoxStackSolidIcon, BracesIcon, BulletlistSolidIcon, CalendarSolidIcon, CheckboxSolidIcon, HeadingIcon, ImageSolidIcon, LayoutSolidIcon, LinkIcon, ListBoxSolidIcon, RulerDimensionSolidIcon, TextColumsIcon, TextStartTIcon } from '@admin/pages/data/icons'
// NOTE: the filename is "text-colums" (sic) — that is the actual upstream filename.

const FIELD_ICONS: Record<DataFieldType, IconComponent> = {
  text: TextStartTIcon,
  url: TextStartTIcon,
  email: TextStartTIcon,
  longText: TextColumsIcon,
  richText: HeadingIcon,
  number: RulerDimensionSolidIcon,
  boolean: CheckboxSolidIcon,
  date: CalendarSolidIcon,
  dateTime: CalendarSolidIcon,
  select: ListBoxSolidIcon,
  multiSelect: BulletlistSolidIcon,
  media: ImageSolidIcon,
  relation: LinkIcon,
  repeater: BoxStackSolidIcon,
  // Structural field types: visual page-node tree and component parameter schema.
  pageTree: LayoutSolidIcon,
  fieldSchema: BracesIcon,
}

export function getFieldIcon(type: DataFieldType): IconComponent {
  return FIELD_ICONS[type]
}
