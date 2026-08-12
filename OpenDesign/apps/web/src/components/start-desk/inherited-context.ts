/**
 * What Product Hub actually handed this session, as one list.
 *
 * The approved Start Desk states the hand-off three times — as a band above the
 * composer, as chips inside it, and in full in the context drawer — so all
 * three read from this one derivation. Three separate readings of the same
 * hand-off is how they drift.
 *
 * ── Why these four ────────────────────────────────────────────────────────
 * The reference names four inherited records (brand profile, business
 * knowledge, design system, extraction snapshot) because its prototype fixture
 * had four. Those records do not exist in this control plane; inventing them
 * would put fabricated client data on a live screen. What the hand-off really
 * carries is the authorized SCOPE — client, project, site — plus the design
 * system the run will be bound to, which MMS Design owns rather than inherits.
 * So the surface keeps the reference's shape and vocabulary (ready vs pending,
 * inherited vs project-owned) and fills it with what is true.
 *
 * A missing entry is `pending`, never hidden: "Product Hub has not sent a
 * project yet" is information the user needs before pressing Send, and a band
 * that silently shrinks to three items communicates nothing.
 */
import type { HubContext } from '@mms/shell';

/** `ready` — the Hub sent it. `pending` — it did not, and that is worth saying. */
export type InheritedState = 'ready' | 'pending';

export interface InheritedItem {
  id: 'client' | 'project' | 'site' | 'design-system';
  /** Short label for the chip and the band's fact column. */
  label: string;
  /** The value, or the reason it is absent. */
  value: string;
  /** Sub-label: the record's status in the reference's voice. */
  status: string;
  state: InheritedState;
  /** Font Awesome Solid glyph, without the `fa-` prefix. */
  icon: string;
  /** Longer sentence, used by the drawer. */
  detail: string;
  /** Who owns the record — the drawer separates inherited from project-owned. */
  owner: 'product-hub' | 'mms-design';
}

export interface InheritedContext {
  /** True when a Product Hub actually fronts this session. */
  hasHub: boolean;
  /** Every entry, ready and pending alike, in the reference's order. */
  items: InheritedItem[];
  /** Headline for the band — the project when known, else the scope we do have. */
  title: string;
  /** One-line summary under the headline. */
  summary: string;
  /** Trail shown in the drawer header, e.g. `Acme → Acme website`. */
  path: string;
}

function scopeItem(
  id: InheritedItem['id'],
  label: string,
  value: string | null | undefined,
  ready: { status: string; detail: string },
  pending: { status: string; detail: string },
  icon: string,
  owner: InheritedItem['owner'],
): InheritedItem {
  const present = Boolean(value && value.trim());
  return {
    id,
    label,
    value: present ? (value as string).trim() : `No ${label.toLowerCase()}`,
    status: present ? ready.status : pending.status,
    state: present ? 'ready' : 'pending',
    detail: present ? ready.detail : pending.detail,
    icon,
    owner,
  };
}

/**
 * @param hubContext the validated hand-off, or null when no Hub fronts this install
 * @param designSystemName the design system the composer is currently bound to
 */
export function deriveInheritedContext(
  hubContext: HubContext | null,
  designSystemName: string | null,
): InheritedContext {
  const items: InheritedItem[] = [
    scopeItem(
      'client',
      'Client',
      hubContext?.client,
      {
        status: 'Authorized',
        detail: 'The client this session is scoped to. Product Hub owns the record; MMS Design reads it.',
      },
      {
        status: 'Not sent',
        detail: 'Product Hub has not scoped this session to a client. Open MMS Design from a client in the Hub to inherit one.',
      },
      'building',
      'product-hub',
    ),
    scopeItem(
      'project',
      'Project',
      hubContext?.project,
      {
        status: 'Authorized',
        detail: 'The project this session is scoped to. Runs started here belong to it.',
      },
      {
        status: 'Pending · not attached',
        detail: 'Product Hub has not sent a project. Work started here is not attached to one, and MMS Design will not choose a project on your behalf.',
      },
      'briefcase',
      'product-hub',
    ),
    scopeItem(
      'site',
      'Site',
      hubContext?.site,
      {
        status: 'Authorized',
        detail: 'The site within the project. Instatic remains the live CMS and the only publisher.',
      },
      {
        status: 'Pending · not attached',
        detail: 'No site was sent with this hand-off.',
      },
      'globe',
      'product-hub',
    ),
    scopeItem(
      'design-system',
      'Design system',
      designSystemName,
      {
        status: 'Project-owned',
        detail: 'The design system the next run will be bound to. MMS Design owns it — it is produced here, not inherited from Product Hub.',
      },
      {
        status: 'None selected',
        detail: 'No design system is bound. The run will be freeform unless one is chosen in the composer below.',
      },
      'layer-group',
      'mms-design',
    ),
  ];

  const client = hubContext?.client?.trim() || '';
  const project = hubContext?.project?.trim() || '';
  const readyCount = items.filter((item) => item.state === 'ready').length;

  return {
    hasHub: Boolean(hubContext),
    items,
    title: project || client || 'No Product Hub project',
    summary: hubContext
      ? `${readyCount} of ${items.length} inherited records are attached.`
      : 'This session was not opened from Product Hub, so nothing is inherited.',
    path: [client, project].filter(Boolean).join(' → ') || 'No authorized scope',
  };
}
