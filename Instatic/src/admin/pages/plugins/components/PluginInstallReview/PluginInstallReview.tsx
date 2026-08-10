/**
 * `PluginInstallReview` — the full-page consent screen shown between opening a
 * package and installing it.
 *
 * Nothing is installed until every requested permission is approved: the
 * approval is all-or-nothing, the outbound host allowlist is disclosed in full,
 * and `editor.code` gets its own unsandboxed warning because that permission
 * runs plugin JavaScript in the admin window with the operator's session.
 *
 * On an upgrade the screen additionally diffs the request against what was
 * already granted, so a package that quietly widens its reach cannot slip
 * through on the strength of having been trusted once.
 */
import type { ReactNode } from 'react'
import { Button } from '@ui/components/Button'
import { FaIcon } from '@ui/components/FaIcon'
import {
  permissionDescription,
  type PluginManifest,
  type PluginPermission,
} from '@core/plugin-sdk'
import { permissionLabel } from '@core/plugins/manifest'
import {
  highRiskCount,
  permissionGlyph,
  riskChip,
  riskChipLabel,
} from '../../utils/pluginIconography'
import {
  computePermissionDiff,
  type PermissionDiffRow,
  type PermissionDiffStatus,
} from './computePermissionDiff'
import styles from './PluginInstallReview.module.css'

interface ReviewPending {
  manifest: PluginManifest
  file?: File
  upgradeFromVersion?: string
  previouslyGrantedPermissions?: PluginPermission[]
  previousNetworkAllowedHosts?: string[]
}

interface PluginInstallReviewProps {
  pending: ReviewPending
  uploading: boolean
  canInstall: boolean
  /** Inline error banner owned by the page, rendered above the panels. */
  error?: ReactNode
  onCancel: () => void
  onApprove: () => void
}

type HostStatus = 'requested' | 'dropped'

interface HostRow {
  host: string
  status: HostStatus
}

function diffHosts(
  next: readonly string[],
  previous: readonly string[] | undefined,
  isUpgrade: boolean,
): HostRow[] {
  const rows: HostRow[] = next.map((host) => ({ host, status: 'requested' as const }))
  if (isUpgrade) {
    const nextSet = new Set(next)
    for (const host of previous ?? []) {
      if (!nextSet.has(host)) rows.push({ host, status: 'dropped' })
    }
  }
  return rows
}

function formatFileSize(bytes: number): string {
  const mb = bytes / 1024 / 1024
  if (mb >= 0.1) return `${mb.toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * What the package brings with it, derived from the manifest. Each row is a
 * thing the operator can point at after installing — not a restatement of the
 * permission list.
 */
function packageIncludes(manifest: PluginManifest): Array<{ label: string; icon: string }> {
  const includes: Array<{ label: string; icon: string }> = []
  if (manifest.adminPages.length > 0) {
    includes.push({ label: 'Admin page', icon: 'window-maximize' })
  }
  if (manifest.entrypoints?.server) {
    includes.push({ label: 'Server worker', icon: 'server' })
  }
  if (manifest.entrypoints?.modules) {
    includes.push({ label: 'Canvas modules', icon: 'cubes' })
  }
  if (manifest.permissions.includes('cms.schedule')) {
    includes.push({ label: 'Scheduled jobs', icon: 'clock' })
  }
  if (manifest.contentAccess && manifest.contentAccess.length > 0) {
    includes.push({ label: 'Content access', icon: 'image' })
  }
  if (manifest.pack) {
    includes.push({ label: 'Bundled visual pack', icon: 'cube' })
  }
  if (manifest.settings && manifest.settings.length > 0) {
    includes.push({ label: 'Stored settings', icon: 'database' })
  }
  if (manifest.frontend?.assets && manifest.frontend.assets.length > 0) {
    includes.push({ label: 'Published-page assets', icon: 'file-lines' })
  }
  return includes
}

function diffBadgeLabel(status: PermissionDiffStatus): string {
  if (status === 'new') return 'New'
  if (status === 'existing') return 'Approved'
  return 'Dropped'
}

export function PluginInstallReview({
  pending,
  uploading,
  canInstall,
  error,
  onCancel,
  onApprove,
}: PluginInstallReviewProps) {
  const { manifest } = pending
  const isUpgrade = Boolean(pending.upgradeFromVersion)
  const runsUnsandboxedCode = manifest.permissions.includes('editor.code')

  const rows: PermissionDiffRow[] = isUpgrade
    ? computePermissionDiff(manifest.permissions, pending.previouslyGrantedPermissions)
    : manifest.permissions.map((permission) => ({ permission, status: 'new' as const }))

  const highRisk = highRiskCount(manifest.permissions)
  const newCount = rows.filter((row) => row.status === 'new').length
  const hostRows = diffHosts(
    manifest.networkAllowedHosts ?? [],
    pending.previousNetworkAllowedHosts,
    isUpgrade,
  )
  const includes = packageIncludes(manifest)

  return (
    <div className={styles.wrap}>
      <section className={styles.heading}>
        <div className={styles.headingText}>
          <div className={styles.breadcrumbs}>
            <Button variant="ghost" className={styles.breadcrumbLink} onClick={onCancel}>
              <span>Plugins</span>
            </Button>
            <FaIcon name="chevron-right" size={9} />
            <span className={styles.breadcrumbCurrent}>
              {isUpgrade ? 'Review update' : 'Review package'}
            </span>
          </div>
          <h1>{isUpgrade ? 'Review before updating' : 'Review before installing'}</h1>
          <p className={styles.headingLead}>
            Nothing is installed until you approve every requested permission.
          </p>
        </div>

        <div className={styles.stepper} aria-label="Installation progress">
          <div className={styles.step}>
            <span>1</span>
            <small>Upload</small>
          </div>
          <i className={styles.stepRule} aria-hidden="true" />
          <div className={styles.step} data-active="true">
            <span>2</span>
            <small>Review</small>
          </div>
          <i className={styles.stepRule} aria-hidden="true" />
          <div className={styles.step}>
            <span>3</span>
            <small>{isUpgrade ? 'Update' : 'Install'}</small>
          </div>
        </div>
      </section>

      {error && <div className={styles.errorSlot}>{error}</div>}

      <div
        className={styles.riskBanner}
        data-tone={runsUnsandboxedCode ? 'danger' : 'warning'}
        role="alert"
      >
        <FaIcon name={runsUnsandboxedCode ? 'shield-virus' : 'triangle-exclamation'} size={30} />
        <strong>
          {runsUnsandboxedCode
            ? 'This package contains unsandboxed editor code.'
            : 'This plugin can change website content and contact external services.'}
        </strong>
      </div>

      <div className={styles.grid}>
        <aside className={styles.packageDetails}>
          <h2>Package details</h2>
          <p className={styles.detailLabel}>Uploaded file</p>
          <div className={styles.packageFile}>
            <span>
              <FaIcon name="file-zipper" size={22} />
            </span>
            <div className={styles.packageFileText}>
              <strong>{pending.file?.name ?? `${manifest.id}.plugin.json`}</strong>
              <small>
                {pending.file
                  ? `${pending.file.name.toLowerCase().endsWith('.zip') ? 'ZIP' : 'JSON'} · ${formatFileSize(pending.file.size)}`
                  : 'Manifest only'}
              </small>
            </div>
          </div>

          {/* These three are not decoration: the package was unzipped, its
              manifest parsed and its sandboxed bundles scanned for forbidden
              literals before this screen could render at all. */}
          <ul className={styles.checkList}>
            <li><FaIcon name="circle-check" size={13} /> Package opened</li>
            <li><FaIcon name="circle-check" size={13} /> Manifest valid</li>
            <li><FaIcon name="circle-check" size={13} /> Sandbox scan passed</li>
          </ul>

          <dl>
            <div>
              <dt>Plugin name</dt>
              <dd>{manifest.name}</dd>
            </div>
            {isUpgrade && (
              <div>
                <dt>Installed</dt>
                <dd>{pending.upgradeFromVersion}</dd>
              </div>
            )}
            <div>
              <dt>{isUpgrade ? 'Uploaded' : 'Version'}</dt>
              <dd>{manifest.version}</dd>
            </div>
            <div>
              <dt>Publisher</dt>
              <dd>{manifest.author?.name ?? 'Not declared'}</dd>
            </div>
            <div>
              <dt>Package type</dt>
              <dd>{pending.file ? 'Plugin ZIP' : 'Plugin manifest'}</dd>
            </div>
            {manifest.license && (
              <div>
                <dt>Licence</dt>
                <dd>{manifest.license}</dd>
              </div>
            )}
          </dl>

          {includes.length > 0 && (
            <>
              <p className={styles.detailLabel}>Includes</p>
              <ul className={styles.includeList}>
                {includes.map((item) => (
                  <li key={item.label}>
                    <FaIcon name={item.icon} size={13} />
                    {item.label}
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className={styles.trustedNote}>
            <FaIcon name="shield-halved" size={16} />
            <span>Install only packages from a trusted publisher.</span>
          </div>
        </aside>

        <section className={styles.permissionReview}>
          <div className={styles.panelHeading}>
            <h2>Permissions requested</h2>
            <span className={styles.riskSummary}>
              {rows.filter((row) => row.status !== 'dropped').length} permissions{' '}
              {highRisk > 0 && <b>· {highRisk} high risk</b>}
            </span>
          </div>

          {/* The approved screen has no upgrade-specific banner — it was drawn
              for a fresh install. A package that quietly widens its reach is
              exactly what this screen exists to catch, so the count stays,
              stated once above the table rather than left to the per-row
              badges alone. */}
          {isUpgrade && newCount > 0 && (
            <div
              className={styles.diffAlert}
              role="alert"
              data-testid="permission-diff-alert"
            >
              <FaIcon name="triangle-exclamation" size={16} />
              <span>
                This update requests{' '}
                <strong>{newCount} new permission{newCount === 1 ? '' : 's'}</strong>.
                Review the highlighted rows before continuing.
              </span>
            </div>
          )}
          {isUpgrade && newCount === 0 && rows.length > 0 && (
            <div
              className={styles.diffNoop}
              role="status"
              data-testid="permission-diff-noop"
            >
              <FaIcon name="circle-check" size={16} />
              <span>No new permissions in this update.</span>
            </div>
          )}

          {rows.length === 0 ? (
            <p
              className={styles.emptyPermissions}
              role="status"
              data-testid="permission-review-empty"
            >
              No permissions requested — this plugin is purely declarative and gets
              no access to CMS data, editor state, or the network.
            </p>
          ) : (
            <div className={styles.permissionTable}>
              <div className={styles.permissionHead}>
                <span aria-hidden="true" />
                <b>Permission</b>
                <b>Risk</b>
                <b>What this means</b>
              </div>
              {rows.map((row) => {
                const chip = riskChip(row.permission)
                return (
                  <article
                    key={`${row.permission}:${row.status}`}
                    className={styles.permissionRow}
                    data-status={row.status}
                    data-permission={row.permission}
                  >
                    <span className={styles.permissionIcon}>
                      <FaIcon name={permissionGlyph(row.permission)} size={16} />
                    </span>
                    <div className={styles.permissionName}>
                      <strong>
                        {permissionLabel(row.permission)}
                        {isUpgrade && (
                          <span className={styles.diffBadge} data-status={row.status}>
                            {diffBadgeLabel(row.status)}
                          </span>
                        )}
                      </strong>
                    </div>
                    <span className={styles.risk} data-risk={chip}>
                      {riskChipLabel(chip)}
                    </span>
                    <p className={styles.permissionMeaning}>
                      {permissionDescription(row.permission)}
                    </p>
                  </article>
                )
              })}
            </div>
          )}

          {runsUnsandboxedCode && (
            <div className={styles.unsandboxed} role="alert" data-testid="unsandboxed-code-alert">
              <FaIcon name="triangle-exclamation" size={18} />
              <div>
                <strong>Runs in the admin window, outside QuickJS</strong>
                <p>
                  Editor code can access the admin DOM and APIs with your signed-in
                  session. Install only if you trust the publisher.
                </p>
              </div>
            </div>
          )}

          <div className={styles.hosts} data-testid="permission-review-network-hosts">
            <h3>Allowed network hosts</h3>
            <p className={styles.hostsLead}>
              The plugin may connect only to the following external hosts.
            </p>
            {hostRows.length === 0 ? (
              <div className={styles.hostRow}>
                <FaIcon name="ban" size={13} />
                <span>No outbound hosts requested</span>
              </div>
            ) : (
              hostRows.map((row) => (
                <div
                  key={`${row.host}:${row.status}`}
                  className={styles.hostRow}
                  data-status={row.status}
                  data-network-host={row.host}
                >
                  <FaIcon name={row.status === 'dropped' ? 'minus' : 'globe'} size={13} />
                  <span>{row.status === 'dropped' ? `Removed: ${row.host}` : row.host}</span>
                </div>
              ))
            )}
            <small className={styles.hostsNote}>
              If these hosts change, the plugin is blocked from connecting until
              re-approved.
            </small>
          </div>
        </section>
      </div>

      <div className={styles.actions}>
        <span className={styles.actionsHint}>
          <FaIcon name="lock" size={13} />
          You may be asked to confirm your password.
        </span>
        <div className={styles.actionsButtons}>
          <Button variant="secondary" size="lg" onClick={onCancel}>
            <span>Cancel</span>
          </Button>
          <Button
            variant="primary"
            size="lg"
            disabled={!canInstall || uploading}
            onClick={onApprove}
          >
            <FaIcon name="shield-halved" size={14} />
            <span>
              {uploading
                ? isUpgrade ? 'Updating' : 'Installing'
                : isUpgrade ? 'Approve update' : 'Approve and install'}
            </span>
          </Button>
        </div>
      </div>
    </div>
  )
}
