/**
 * ProductHubContextDrawer — the read-only record behind the handoff band.
 *
 * Transcribed from the approved prototype's `ProductHubContextDrawer`
 * (`projectContext.jsx`) and `project-context.css`. It exists so the band and
 * the chips lead somewhere: what exactly was inherited, who owns each record,
 * and — the part that matters — what was NOT sent.
 *
 * Read-only by design. Product Hub owns extraction evidence, permissions and
 * approvals; MMS Design owns conversations, files, layout and the project
 * design system. A control in here that edited an inherited record would put
 * the same record under two authorities.
 *
 * Modal behaviour: focus lands on the close button, Escape and a backdrop press
 * both close, and the page behind is locked from scrolling while it is open so
 * the drawer's own scroll does not chain into it.
 */
import { useEffect, useRef } from 'react';
import type { HubContext } from '@mms/shell';
import type { InheritedContext, InheritedItem } from './inherited-context';

export interface ProductHubContextDrawerProps {
  open: boolean;
  onClose: () => void;
  context: InheritedContext;
  hubContext: HubContext | null;
}

const ROLE_LABEL: Record<string, string> = {
  operator: 'MMSBUILD Operator',
  agency: 'MMSBUILD Agency',
  client: 'Client',
  'super-admin': 'Super Admin',
};

export function ProductHubContextDrawer({
  open,
  onClose,
  context,
  hubContext,
}: ProductHubContextDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose, open]);

  if (!open) return null;

  const inherited = context.items.filter((item) => item.owner === 'product-hub');
  const projectOwned = context.items.filter((item) => item.owner === 'mms-design');
  const pending = context.items.filter((item) => item.state === 'pending');

  return (
    <div
      className="sd-drawer-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="sd-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sd-drawer-title"
      >
        <header className="sd-drawer__head">
          <div>
            <small>MMSBUILD WRAPPER · READ ONLY</small>
            <h2 id="sd-drawer-title">Inherited project context</h2>
            <p>{context.path}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close inherited project context"
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </header>

        <div className="sd-drawer__scroll">
          <div
            className={
              context.hasHub ? 'sd-drawer__state' : 'sd-drawer__state sd-drawer__state--warn'
            }
          >
            <span>
              <i
                className={`fa-solid fa-${context.hasHub ? 'circle-check' : 'circle-exclamation'}`}
                aria-hidden="true"
              />
            </span>
            <div>
              <strong>
                {context.hasHub
                  ? 'Approved Product Hub records are available'
                  : 'No Product Hub session is in front of this workspace'}
              </strong>
              <p>
                {context.hasHub
                  ? 'This project may read these records. It cannot edit or silently replace them.'
                  : 'Open MMS Design from Product Hub to inherit an authorized client and project. Nothing is assumed on your behalf.'}
              </p>
            </div>
          </div>

          <ContextSection icon="briefcase" title="Project scope">
            <dl className="sd-drawer__defs">
              <div>
                <dt>Role</dt>
                <dd>{hubContext ? (ROLE_LABEL[hubContext.role] ?? hubContext.role) : 'Not signed in through Product Hub'}</dd>
              </div>
              <div>
                <dt>Client</dt>
                <dd>{hubContext?.client ?? 'Not sent'}</dd>
              </div>
              <div>
                <dt>Project</dt>
                <dd>{hubContext?.project ?? 'Not sent'}</dd>
              </div>
              <div>
                <dt>Originating surface</dt>
                <dd>{hubContext?.origin ?? 'Not sent'}</dd>
              </div>
            </dl>
          </ContextSection>

          <ContextSection icon="palette" title="Inherited inputs · Product Hub owned">
            <div className="sd-drawer__records">
              {inherited.map((item) => (
                <RecordRow key={item.id} item={item} />
              ))}
            </div>
          </ContextSection>

          <ContextSection icon="layer-group" title="Design-system binding · MMS Design owned">
            {projectOwned.map((item) => (
              <div className="sd-drawer__output" key={item.id}>
                <span className="sd-drawer__mark">{initialsOf(item.value)}</span>
                <div>
                  <strong>{item.value}</strong>
                  <p>{item.detail}</p>
                  <small>{item.status}</small>
                </div>
              </div>
            ))}
          </ContextSection>

          <ContextSection icon="globe" title="Two different cloning jobs">
            <div className="sd-drawer__clone">
              <article>
                <small>PRODUCT HUB</small>
                <strong>Extract existing website</strong>
                <p>Permissioned capture, immutable evidence and approval.</p>
              </article>
              <i className="fa-solid fa-arrow-right" aria-hidden="true" />
              <article>
                <small>MMS DESIGN</small>
                <strong>Website clone</strong>
                <p>Editable visual reconstruction and project files.</p>
              </article>
            </div>
          </ContextSection>

          {pending.length > 0 && (
            <div className="sd-drawer__withheld" role="note">
              <i className="fa-solid fa-circle-exclamation" aria-hidden="true" />
              <div>
                <strong>
                  {pending.length === 1
                    ? `${pending[0]?.label} is not attached`
                    : `${pending.length} records are not attached`}
                </strong>
                <p>
                  {pending.map((item) => item.detail).join(' ')}
                </p>
              </div>
            </div>
          )}

          <div className="sd-drawer__owner">
            <i className="fa-solid fa-shield-halved" aria-hidden="true" />
            <p>
              <strong>Authority stays separated.</strong> Product Hub owns extraction evidence,
              permissions and approvals. MMS Design owns conversations, editable files, layout work
              and the project design system. Instatic remains the live CMS and the sole publisher.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

function ContextSection({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="sd-drawer__section">
      <header>
        <i className={`fa-solid fa-${icon}`} aria-hidden="true" />
        <h3>{title}</h3>
      </header>
      {children}
    </section>
  );
}

function RecordRow({ item }: { item: InheritedItem }) {
  return (
    <article data-state={item.state}>
      <span>
        <i
          className={`fa-solid fa-${item.state === 'ready' ? 'circle-check' : 'circle-exclamation'}`}
          aria-hidden="true"
        />
      </span>
      <div>
        <strong>{item.value}</strong>
        <p>{item.detail}</p>
      </div>
      <em>{item.status}</em>
    </article>
  );
}

/** Two letters for the design-system mark, from its own name. */
function initialsOf(value: string): string {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '—';
  if (words.length === 1) return (words[0] ?? '').slice(0, 2).toUpperCase();
  return `${words[0]?.charAt(0) ?? ''}${words[1]?.charAt(0) ?? ''}`.toUpperCase();
}
