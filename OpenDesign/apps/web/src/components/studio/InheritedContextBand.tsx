/**
 * InheritedContextBand — the approved Studio composer's `.chat-inherited-context`
 * row (`prototype-reference/src/Workspace.jsx:607-616`, styles
 * `prototype-reference/src/project-context.css:59-109`).
 *
 * It sits at the top of the composer shell and states, at the moment the run is
 * written, what that run will inherit: the Product Hub brief, the bound design
 * system, and the release state of the source. The prototype read a frozen
 * fixture; this reads `deriveInheritedContext`, which reports what the session
 * actually carries — the build kit lists the fixture among the behaviours a
 * developer "must not preserve", and names the composer source label as one of
 * the three surfaces that must show handoff state (`AGENTS.md:24`).
 */
import { FaIcon } from '@mms/shell';
import type { InheritedContext } from '../start-desk/inherited-context';

export interface InheritedContextBandProps {
  context: InheritedContext;
  onOpenContext: () => void;
  /** Label for the design-system chip; the reference always shows one. */
  designSystemLabel: string;
}

export function InheritedContextBand({
  context,
  onOpenContext,
  designSystemLabel,
}: InheritedContextBandProps) {
  // Exactly three chips, as the reference draws them: the brief, the bound
  // design system, and ONE release-state chip. Listing every inherited record
  // instead put six chips in a 460px row, so the last one was always sliced in
  // half at the scroller's edge. The full record list is one click away in the
  // context drawer the first chip opens.
  const pending = context.items.find((item) => item.state !== 'ready');
  const stateLabel = !context.hasHub
    ? context.summary
    : pending
      ? `${pending.value} · ${pending.status}`
      : context.items.map((item) => item.value).join(' · ');

  return (
    <div className="chat-inherited-context" aria-label="Inherited Product Hub context">
      <button type="button" onClick={onOpenContext} title={context.summary}>
        <FaIcon name="diagram-project" size={11} />
        <span>
          <strong>{context.title}</strong>
          <small>{context.summary}</small>
        </span>
      </button>
      <span title={designSystemLabel}>
        <FaIcon name="palette" size={11} />
        {designSystemLabel}
      </span>
      <span
        className={context.hasHub && !pending ? 'ready' : 'withheld'}
        title={stateLabel}
      >
        <FaIcon
          name={context.hasHub && !pending ? 'circle-check' : 'circle-exclamation'}
          size={11}
        />
        {stateLabel}
      </span>
    </div>
  );
}
