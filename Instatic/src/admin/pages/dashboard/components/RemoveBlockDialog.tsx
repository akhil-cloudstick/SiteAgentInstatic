/**
 * RemoveBlockDialog — type-to-confirm before a block leaves the grid.
 *
 * Customize mode lets a user drag and resize tiles; removing one used to
 * be possible only by dragging it onto the block-library pill, which is
 * undiscoverable. Each tile now carries an explicit remove button, and
 * because that button is one click away from wiping a tile the user may
 * have arranged deliberately, it routes through this confirmation.
 *
 * The gate is typing the block's own name. That is deliberately a *low*
 * bar rather than a scary one — matching is trimmed and case-insensitive,
 * so "live preview" clears "Live preview". Removing a block is fully
 * reversible (it returns to the block library and can be dragged back),
 * so the dialog's job is to prove intent, not to frighten. The copy says
 * so, in plain words, for the same reason the tile placeholders do.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { Dialog } from '@ui/components/Dialog'
import { Button } from '@ui/components/Button'
import { Input } from '@ui/components/Input'
import { FaIcon } from '@ui/components/FaIcon'
import styles from './RemoveBlockDialog.module.css'

interface RemoveBlockDialogProps {
  /** Display name of the block being removed, e.g. "Live preview". */
  blockName: string | null
  onCancel: () => void
  onConfirm: () => void
}

/** Trimmed, case-insensitive match — proves intent without punishing typing. */
function matches(typed: string, expected: string): boolean {
  return typed.trim().toLowerCase() === expected.trim().toLowerCase()
}

export function RemoveBlockDialog({ blockName, onCancel, onConfirm }: RemoveBlockDialogProps) {
  const [typed, setTyped] = useState('')
  const fieldId = useId()
  const fieldRef = useRef<HTMLInputElement | null>(null)

  // Reset the field whenever a different block is targeted, so a previous
  // confirmation can never carry over and pre-arm this one.
  useEffect(() => {
    setTyped('')
  }, [blockName])

  const open = blockName !== null
  const confirmed = open && matches(typed, blockName)

  function handleConfirm() {
    if (!confirmed) return
    onConfirm()
  }

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      tone="danger"
      size="md"
      title="Remove this block?"
      className={styles.dialog}
      bodyClassName={styles.body}
      footerClassName={styles.footer}
      initialFocusRef={fieldRef}
      footer={(
        <>
          <Button variant="ghost" className={styles.cancelButton} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="ghost"
            className={styles.removeButton}
            disabled={!confirmed}
            onClick={handleConfirm}
          >
            <FaIcon name="trash-can" size={14} /> Remove block
          </Button>
        </>
      )}
    >
      <p className={styles.lead}>
        <span className={styles.leadName}>{blockName}</span> will be taken off
        your dashboard.
      </p>
      <p className={styles.reassure}>
        You can add it back any time from the block library — nothing on your
        site changes.
      </p>

      <label className={styles.label} htmlFor={fieldId}>
        Type <span className={styles.token}>{blockName}</span> to confirm
      </label>
      <Input
        id={fieldId}
        ref={fieldRef}
        className={styles.field}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        // Enter is a natural "submit" here; only acts once the text matches.
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            handleConfirm()
          }
        }}
        placeholder={blockName ?? ''}
        autoComplete="off"
        spellCheck={false}
        aria-label={`Type ${blockName ?? ''} to confirm removal`}
      />
    </Dialog>
  )
}
