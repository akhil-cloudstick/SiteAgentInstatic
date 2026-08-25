/**
 * CanvasNotch — top-center quick-action chrome for the Content document
 * canvas (Heading / Text / Media / Insert data token).
 *
 * The Site editor used to mount this too, with favourite-module buttons, the
 * "+ Add" module picker and Undo/Redo. That chrome was removed from the site
 * canvas: insertion there lives on the selection toolbar's "Insert module"
 * button, the Layers panel's "+", and the canvas right-click menu, and history
 * is keyboard-only (`useUndoRedoShortcuts`). What is left is the fixed action
 * row the Content canvas draws above its editor, so every action is supplied
 * by the caller.
 */
import type { Ref, SyntheticEvent } from "react";
import type { IconComponent } from "pixel-art-icons/types";
import { Button } from "@ui/components/Button";
import { cn } from "@ui/cn";
import styles from "./CanvasNotch.module.css";

/** Notch action — a literal icon component plus what clicking it does. */
export interface CanvasNotchAction {
  id: string;
  label: string;
  icon: IconComponent;
  onClick: () => void;
  /** Renders the action disabled, with this string as the tooltip. */
  disabledReason?: string;
  /** Anchor ref for an action-owned popover (Content canvas token picker). */
  buttonRef?: Ref<HTMLButtonElement>;
  /** Action-owned popover is open: exposed via aria-expanded, tooltip suppressed. */
  expanded?: boolean;
  /**
   * Marks the reference's leading "+ Insert" action, which reads as the
   * primary affordance (accent-on-tint, inverting on hover) and whose
   * accessible name is its own label rather than "Add <label>".
   */
  emphasis?: "primary";
}

interface CanvasNotchProps {
  actions: CanvasNotchAction[];
}

export function CanvasNotch({ actions }: CanvasNotchProps) {
  return (
    <div
      className={styles.shell}
      aria-label="Insert blocks"
      data-testid="canvas-notch"
      onClick={stopCanvasInteraction}
    >
      <div className={styles.notch}>
        {actions.map((action) => {
          const ActionIcon = action.icon;
          const isPrimary = action.emphasis === "primary";
          // The reference labels every notch button; only the leading Insert
          // action names itself, the rest read as "Add <thing>".
          const accessibleName = isPrimary ? action.label : `Add ${action.label}`;
          return (
            <Button
              key={action.id}
              variant="ghost"
              size="sm"
              className={cn(styles.quickButton, isPrimary && styles.insertButton)}
              ref={action.buttonRef}
              onClick={action.onClick}
              disabled={Boolean(action.disabledReason)}
              aria-label={accessibleName}
              aria-expanded={action.expanded}
              tooltip={action.expanded ? undefined : (action.disabledReason ?? accessibleName)}
              data-testid={`canvas-notch-${testIdPart(action.label)}-btn`}
            >
              <ActionIcon size={13} aria-hidden="true" />
              <span className={styles.quickButtonLabel}>{action.label}</span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}

// The notch sits inside the canvas surface, which has its own click handlers
// (deselect, shortcuts, …). Stop propagation so it feels like chrome, not a
// click on empty canvas.
function stopCanvasInteraction(event: SyntheticEvent) {
  event.stopPropagation();
}

function testIdPart(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
