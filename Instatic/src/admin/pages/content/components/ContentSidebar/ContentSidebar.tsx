import { useRef, type CSSProperties, type ReactNode } from 'react'
import { Button } from '@ui/components/Button'
import { BookOpenSolidIcon } from 'pixel-art-icons/icons/book-open-solid'
import { ImagesSolidIcon } from 'pixel-art-icons/icons/images-solid'
import { AiSettingsSolidIcon } from 'pixel-art-icons/icons/ai-settings-solid'
import type { IconComponent } from 'pixel-art-icons/types'
import { useWorkspaceLayout } from '@admin/state/workspaceLayout'
import { SidebarResizeHandle } from '@admin/shared/SidebarResizeHandle'
import styles from './ContentSidebar.module.css'

export type ContentPanelId = 'content' | 'media' | 'agent'

interface ContentSidebarProps {
  activePanel: ContentPanelId | null
  onActivePanelChange: (panel: ContentPanelId | null) => void
  contentPanel: ReactNode
  mediaPanel: ReactNode
  /**
   * AI Assistant panel. Mounted in the same panel slot as content + media
   * (same docked variant the site editor uses), so the chat lives inside
   * the workspace chrome instead of floating over it.
   */
  agentPanel: ReactNode
  canUseAiChat: boolean
}

export function ContentSidebar({
  activePanel,
  onActivePanelChange,
  contentPanel,
  mediaPanel,
  agentPanel,
  canUseAiChat,
}: ContentSidebarProps) {
  const sidebarRef = useRef<HTMLElement | null>(null)
  const leftSidebarWidth = useWorkspaceLayout((s) => s.leftSidebarWidth)
  const setLeftSidebarWidth = useWorkspaceLayout((s) => s.setLeftSidebarWidth)
  // The reference collapses the slot with `[data-expanded="false"]` rather than
  // by zeroing the width variable, so the stored width survives a close/reopen
  // and the 150ms width transition has something to animate back to.
  const style = {
    '--content-panel-width': `${leftSidebarWidth}px`,
  } as CSSProperties

  return (
    <aside
      ref={sidebarRef}
      className={styles.sidebar}
      data-testid="left-sidebar"
      data-expanded={activePanel ? 'true' : 'false'}
      data-active-panel={activePanel ?? 'none'}
      style={style}
    >
      <nav
        aria-label="Content panel dock"
        className={styles.rail}
        data-testid="content-panel-rail"
      >
        <div className={styles.primaryStack}>
          <div className={styles.itemGroup} data-testid="panel-rail-primary">
            <ContentRailButton
              id="content"
              label="Content"
              icon={BookOpenSolidIcon}
              iconName="book-open"
              active={activePanel === 'content'}
              onToggle={() => onActivePanelChange(activePanel === 'content' ? null : 'content')}
            />
            <ContentRailButton
              id="media"
              label="Media"
              icon={ImagesSolidIcon}
              iconName="images"
              active={activePanel === 'media'}
              onToggle={() => onActivePanelChange(activePanel === 'media' ? null : 'media')}
            />
          </div>
        </div>
        {canUseAiChat && (
          <div className={styles.globalGroup} data-testid="panel-rail-global">
            <ContentRailButton
              id="agent"
              label="AI assistant"
              icon={AiSettingsSolidIcon}
              iconName="ai-settings-solid"
              active={activePanel === 'agent'}
              onToggle={() => onActivePanelChange(activePanel === 'agent' ? null : 'agent')}
            />
          </div>
        )}
      </nav>

      <div
        className={styles.panelSlot}
        data-testid="left-sidebar-panel-slot"
        inert={activePanel ? undefined : true}
      >
        <div className={styles.panelMount}>
          {activePanel === 'content'
            ? contentPanel
            : activePanel === 'media'
              ? mediaPanel
              : activePanel === 'agent' && canUseAiChat
                ? agentPanel
                : null}
        </div>
      </div>

      {activePanel && (
        <SidebarResizeHandle
          side="left"
          width={leftSidebarWidth}
          targetRef={sidebarRef}
          cssVariable="--content-panel-width"
          ariaLabel="Resize content sidebar"
          onResize={setLeftSidebarWidth}
          className={styles.resizeHandle}
        />
      )}
    </aside>
  )
}

interface ContentRailButtonProps {
  id: ContentPanelId
  label: string
  icon: IconComponent
  iconName: string
  active: boolean
  onToggle: () => void
}

function ContentRailButton({
  id,
  label,
  icon,
  iconName,
  active,
  onToggle,
}: ContentRailButtonProps) {
  const RailIcon = icon
  const action = active ? 'Close' : 'Open'

  return (
    <Button
      variant="ghost"
      size="md"
      iconOnly
      pressed={active}
      aria-label={`${action} ${label} panel`}
      tooltip={`${label} panel`}
      data-testid={`panel-rail-${id}`}
      data-icon={iconName}
      // The reference assigns each dock a fixed identity colour keyed off this
      // attribute (content = deep green, media = navy ink, AI = MMS yellow)
      // instead of the hash-derived tint the Site rail uses.
      data-panel-id={id}
      onClick={onToggle}
      className={styles.railButton}
    >
      <span className={styles.activeIndicator} aria-hidden="true" />
      <RailIcon size={16} className={styles.railIcon} />
    </Button>
  )
}
