/**
 * MediaStoragePanel — storage adapters and migration.
 *
 * Transcribed from the MMSBUILD Media reference (`screens/media/src/App.jsx`
 * → `StoragePanel`). The reference is deliberately spare: an eyebrow, one
 * heading, one line of description, a card per adapter, and a single
 * "Review migration" action — or a permission card when the operator's role
 * cannot see storage at all.
 *
 * Everything shown is REAL. The reference's two sample cards ("Local media
 * storage · 2.6 GB used", "S3-compatible storage · Not configured") are
 * placeholders; here one card is rendered per registered adapter, and its
 * status line reports which roles that adapter actually serves and how many
 * assets are pinned to it.
 *
 * The reference's card action is a single "Configure" button. It reveals the
 * role picker, which is how an adapter is actually elected in Instatic — so
 * the resting layout matches the reference while the real capability stays
 * reachable.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@ui/components/Button'
import { FaIcon } from '@ui/components/FaIcon'
import { Select } from '@ui/components/Select'
import { SkeletonBlock } from '@ui/components/Skeleton'
import type { MediaAssetRole } from '@core/plugin-sdk'
import {
  electCmsMediaAdapter,
  getCmsMediaStorageState,
  type CmsMediaAdapterSummary,
  type CmsMediaStorageState,
} from '@core/persistence/cmsMediaStorage'
import { getErrorMessage } from '@core/utils/errorMessage'
import styles from './MediaStoragePanel.module.css'

/** Human label for a storage role. */
const ROLE_LABEL: Record<string, string> = {
  original: 'Originals',
  variant: 'Variants',
}

/**
 * The reference uses a cloud for the built-in store and an archive box for
 * everything else.
 */
function adapterGlyph(adapter: CmsMediaAdapterSummary): string {
  return adapter.isBuiltIn ? 'cloud' : 'box-archive'
}

/**
 * The card's status line. Reports real election state — never a fabricated
 * byte total like the reference's sample copy.
 */
function adapterStatus(
  adapter: CmsMediaAdapterSummary,
  state: CmsMediaStorageState,
): { text: string; elected: boolean } {
  const elections = state.elections.filter((election) => election.adapterId === adapter.id)
  if (elections.length === 0) return { text: 'Not in use', elected: false }
  const roles = elections
    .map((election) => ROLE_LABEL[election.role] ?? election.role)
    .join(' · ')
  const assets = elections.reduce((total, election) => total + election.assetCount, 0)
  return {
    text: `Active · ${roles} · ${assets} ${assets === 1 ? 'asset' : 'assets'}`,
    elected: true,
  }
}

export function MediaStoragePanel() {
  const [state, setState] = useState<CmsMediaStorageState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [configuring, setConfiguring] = useState<string | null>(null)
  const [pendingRole, setPendingRole] = useState<MediaAssetRole | null>(null)

  // useCallback kept: stable identity for the [reload] useEffect dep array.
  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setState(await getCmsMediaStorageState())
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to load storage state'))
    } finally {
      setLoading(false)
    }
  }, [])

  // One-shot data fetch — the panel owns the request lifecycle, so the
  // synchronous setState inside `reload` is the sanctioned pattern here.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void reload()
  }, [reload])
  /* eslint-enable react-hooks/set-state-in-effect */

  async function elect(role: MediaAssetRole, adapterId: string) {
    setPendingRole(role)
    setError(null)
    try {
      await electCmsMediaAdapter({ role, adapterId })
      setConfiguring(null)
      await reload()
    } catch (err) {
      setError(getErrorMessage(err, 'Could not change the storage adapter'))
    } finally {
      setPendingRole(null)
    }
  }

  if (loading && !state) {
    return (
      <div className={styles.root}>
        <SkeletonBlock minHeight={220} />
      </div>
    )
  }

  // A 403 from the storage endpoint means the role cannot see storage at
  // all — the reference's permission card.
  if (!state) {
    return (
      <div className={styles.root}>
        <p className={styles.eyebrow}>Secondary administration</p>
        <h2 className={styles.title}>Storage adapters</h2>
        <p className={styles.description}>
          Connect or migrate storage without changing the media editing workflow.
        </p>
        <div className={styles.permissionCard} role="status">
          <span className={styles.permissionIcon} aria-hidden="true">
            <FaIcon name="lock" size={25} />
          </span>
          <h3 className={styles.permissionTitle}>Agency or developer access required</h3>
          <p className={styles.permissionBody}>
            Your role cannot view storage credentials or run migrations.
          </p>
        </div>
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>
    )
  }

  return (
    <div className={styles.root} data-testid="media-storage-panel">
      <p className={styles.eyebrow}>Secondary administration</p>
      <h2 className={styles.title}>Storage adapters</h2>
      <p className={styles.description}>
        Connect or migrate storage without changing the media editing workflow.
      </p>

      {state.adapters.map((adapter) => {
        const status = adapterStatus(adapter, state)
        const open = configuring === adapter.id
        return (
          <div key={adapter.id}>
            <article className={styles.adapterCard}>
              <div className={styles.adapterIdentity}>
                <span className={styles.adapterIcon} aria-hidden="true">
                  <FaIcon name={adapterGlyph(adapter)} size={17} />
                </span>
                <div className={styles.adapterText}>
                  <strong className={styles.adapterName}>{adapter.label}</strong>
                  <small className={styles.adapterMeta}>{status.text}</small>
                </div>
              </div>

              {status.elected && !open ? (
                <span className={styles.statusChip}>Connected</span>
              ) : (
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => setConfiguring(open ? null : adapter.id)}
                  aria-expanded={open}
                >
                  {open ? 'Cancel' : 'Configure'}
                </Button>
              )}
            </article>

            {open && (
              <div className={styles.rolePicker}>
                <span className={styles.rolePickerLabel}>
                  Use this adapter for
                </span>
                {state.roles.map((role) => (
                  <Select
                    key={role}
                    aria-label={`Adapter for ${ROLE_LABEL[role] ?? role}`}
                    fieldSize="md"
                    disabled={pendingRole !== null}
                    value={
                      state.elections.find((election) => election.role === role)?.adapterId ?? ''
                    }
                    onChange={(event) => {
                      const next = event.target.value
                      if (next) void elect(role, next)
                    }}
                    options={[
                      {
                        value: '',
                        label: `${ROLE_LABEL[role] ?? role} — not elected`,
                        textValue: `${ROLE_LABEL[role] ?? role} — not elected`,
                      },
                      ...state.adapters.map((candidate) => ({
                        value: candidate.id,
                        label: `${ROLE_LABEL[role] ?? role} → ${candidate.label}`,
                        textValue: `${ROLE_LABEL[role] ?? role} → ${candidate.label}`,
                      })),
                    ]}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}

      <Button
        variant="primary"
        size="lg"
        className={styles.reviewAction}
        onClick={() => setConfiguring(null)}
        disabled={state.adapters.length < 2}
      >
        <FaIcon name="arrow-right-arrow-left" size={13} />
        <span>Review migration</span>
      </Button>

      <p className={styles.migrationNote}>
        {state.adapters.length < 2
          ? 'A second adapter is required before media can be migrated.'
          : 'Migration moves stored bytes between adapters. No files move until you confirm.'}
      </p>

      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  )
}
