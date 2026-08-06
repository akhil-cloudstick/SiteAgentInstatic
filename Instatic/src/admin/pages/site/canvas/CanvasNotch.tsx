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
import type { SyntheticEvent } from "react";
import type { IconComponent } from "pixel-art-icons/types";
import { Button } from "@ui/components/Button";
import styles from "./CanvasNotch.module.css";

/** Notch action — a literal icon component plus what clicking it does. */
export interface CanvasNotchAction {
  id: string;
  label: string;
  icon: IconComponent;
  onClick: () => void;
  /** Renders the action disabled, with this string as the tooltip. */
  disabledReason?: string;
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
          return (
            <Button
              key={action.id}
              variant="ghost"
              size="sm"
              iconOnly
              className={styles.quickButton}
              onClick={action.onClick}
              disabled={Boolean(action.disabledReason)}
              aria-label={`Add ${action.label}`}
              tooltip={action.disabledReason ?? `Add ${action.label}`}
              data-testid={`canvas-notch-${testIdPart(action.label)}-btn`}
            >
              <ActionIcon size={14} aria-hidden="true" />
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
