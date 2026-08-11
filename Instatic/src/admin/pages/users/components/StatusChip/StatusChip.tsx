/**
 * StatusChip — the approved screen's `.status-chip`.
 *
 * Six semantic tones, chosen by meaning rather than hashed from the label:
 * Active/MFA-on read success, Suspended reads danger, Owner and Admin share
 * the administrative blue, every other role is violet, and anything
 * informational is neutral. `TagPill` (the admin's generic pill) auto-assigns
 * an accent from the label text, which is right for user-authored tags and
 * wrong here — a renamed role must not change colour.
 */
import type { ReactNode } from 'react'
import { cn } from '@ui/cn'
import type { ChipTone } from '../../types'
import styles from './StatusChip.module.css'

const TONE_CLASS: Record<ChipTone, string> = {
  success: styles.success,
  danger: styles.danger,
  owner: styles.owner,
  admin: styles.admin,
  role: styles.role,
  neutral: styles.neutral,
}

interface StatusChipProps {
  tone: ChipTone
  children: ReactNode
  className?: string
}

export function StatusChip({ tone, children, className }: StatusChipProps) {
  return <span className={cn(styles.chip, TONE_CLASS[tone], className)}>{children}</span>
}
