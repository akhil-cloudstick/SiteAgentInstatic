/**
 * The Start Desk's Product Hub surfaces: the handoff band, the clone-ownership
 * strip, and the inherited-context chips that sit in the composer.
 *
 * All three are transcriptions of the approved prototype's `projectContext.jsx`
 * + `project-context.css`; geometry lives in `context-surfaces.css`. What they
 * SHOW comes from `deriveInheritedContext`, not from the prototype's fixture —
 * see that module for why.
 *
 * They are views. None of them fetches, and none of them can change the
 * hand-off: Product Hub owns those records, and MMS Design reads them.
 */
import type { InheritedContext, InheritedItem } from './inherited-context';

/** Both states share one glyph vocabulary, so a pending row is legible at a glance. */
function stateIcon(item: InheritedItem): string {
  return item.state === 'ready' ? 'circle-check' : 'circle-exclamation';
}

export interface ContextHandoffBandProps {
  context: InheritedContext;
  onOpenContext: () => void;
  /**
   * Extra class for surfaces that place the band differently. The Projects
   * screen uses the reference's `.context-handoff-band.compact` bottom margin
   * (20px) where the Start Desk uses 18px; one modifier keeps the band a single
   * shared component instead of two near-identical copies.
   */
  className?: string;
}

/**
 * The band above the composer: where this session's context came from, what
 * arrived with it, and a way into the full record.
 */
export function ContextHandoffBand({
  context,
  onOpenContext,
  className,
}: ContextHandoffBandProps) {
  return (
    <section
      className={className ? `sd-handoff ${className}` : 'sd-handoff'}
      aria-label="Product Hub handoff status"
    >
      <div className="sd-handoff__source">
        <span className="sd-handoff__icon" aria-hidden="true">
          <i className="fa-solid fa-diagram-project" />
        </span>
        <div>
          <small>MMSBUILD WRAPPER · FROM PRODUCT HUB</small>
          <strong title={context.title}>{context.title}</strong>
          <span>{context.summary}</span>
        </div>
      </div>
      <div className="sd-handoff__facts" aria-label="Inherited context summary">
        {context.items.map((item) => (
          <span key={item.id} className={item.state === 'ready' ? 'ready' : 'withheld'}>
            <i className={`fa-solid fa-${stateIcon(item)}`} aria-hidden="true" />
            <b title={item.value}>{item.value}</b>
            <small title={item.status}>{item.status}</small>
          </span>
        ))}
      </div>
      <button type="button" className="sd-handoff__open" onClick={onOpenContext}>
        View inherited context <i className="fa-solid fa-arrow-right" aria-hidden="true" />
      </button>
    </section>
  );
}

/**
 * Website cloning happens in two different places, and conflating them is how a
 * team ends up treating an unapproved scrape as an archive of record. The strip
 * states the split at the moment the user picks Website clone — Product Hub
 * owns the permissioned capture and its evidence; MMS Design owns the editable
 * reconstruction and the project files.
 */
export function CloneBoundary({ context }: { context: InheritedContext }) {
  return (
    <section className="sd-clone-boundary" aria-label="Website cloning ownership">
      <div>
        <small>PRODUCT HUB</small>
        <strong>Extract existing website</strong>
        <span>
          Creates the governed source archive, with permissioned capture, immutable evidence and
          approval.
        </span>
      </div>
      <i className="fa-solid fa-arrow-right" aria-hidden="true" />
      <div>
        <small>MMS DESIGN · CURRENT START</small>
        <strong>Website clone</strong>
        <span>
          {context.hasHub
            ? 'Builds editable visual files from an authorized direct-reference URL.'
            : 'Builds editable visual files from an authorized direct-reference URL. No Product Hub archive is attached to this session.'}
        </span>
      </div>
    </section>
  );
}

export interface InheritedContextChipsProps {
  context: InheritedContext;
  onOpenContext: () => void;
}

/**
 * The same hand-off, restated inside the composer as chips — so what the run
 * will inherit is visible in the place the run is written, not only in a band
 * the user has already scrolled past.
 */
export function InheritedContextChips({ context, onOpenContext }: InheritedContextChipsProps) {
  return (
    <>
      {context.items.map((item) => (
        <button
          type="button"
          key={item.id}
          className={
            item.state === 'ready'
              ? 'sd-context-chip'
              : 'sd-context-chip sd-context-chip--withheld'
          }
          onClick={onOpenContext}
          title={`${item.label}: ${item.value} — ${item.status}`}
        >
          <i className={`fa-solid fa-${item.icon}`} aria-hidden="true" />
          {item.value}
          <span>{item.status}</span>
        </button>
      ))}
    </>
  );
}
