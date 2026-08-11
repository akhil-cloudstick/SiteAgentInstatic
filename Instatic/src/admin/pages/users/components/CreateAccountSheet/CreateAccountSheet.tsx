/**
 * CreateAccountSheet — the approved screen's `.create-sheet`.
 *
 * A right-hand side sheet rather than a centred dialog, because the approved
 * account-creation flow keeps the roster visible behind it: the operator is
 * adding a person to a team they can still see.
 *
 * Direct creation, not an invitation. The account exists and is active the
 * moment it is created; no email is sent and there is no pending-invite state
 * to reconcile. The operator shares the initial password out of band, which is
 * why the field has a reveal toggle and the copy says so.
 *
 * Why not the `Dialog` primitive: `Dialog` is a centred, size-clamped modal
 * with its own header/footer bands. Reshaping it into a full-height edge sheet
 * would mean overriding almost every rule it owns and would change a primitive
 * six other workspaces depend on. The sheet is ~90 lines of local chrome
 * instead.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '@ui/components/Button'
import { FaIcon } from '@ui/components/FaIcon'
import { Input } from '@ui/components/Input'
import { Select } from '@ui/components/Select'
import type { CmsRole } from '@core/persistence'
import { roleOutcome } from '../../utils/roleOutcome'
import { emptyUserForm, type UserFormState } from '../../types'
import styles from './CreateAccountSheet.module.css'

/** Server minimum, mirrored client-side so the operator hears it sooner. */
const PASSWORD_MIN_LENGTH = 12
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/

interface CreateAccountSheetProps {
  /** Assignable roles — Owner is setup-only and never appears. */
  roles: CmsRole[]
  defaultRoleId: string
  busy: boolean
  /** Server-side failure from the create call, shown beside the fields. */
  error: string | null
  onClose: () => void
  onCreate: (form: UserFormState) => Promise<void>
}

export function CreateAccountSheet({
  roles,
  defaultRoleId,
  busy,
  error,
  onClose,
  onCreate,
}: CreateAccountSheetProps) {
  const [form, setForm] = useState<UserFormState>(() => ({
    ...emptyUserForm,
    roleId: defaultRoleId,
  }))
  const [showPassword, setShowPassword] = useState(false)
  const [showCapabilities, setShowCapabilities] = useState(false)
  const [validationError, setValidationError] = useState('')
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // Focus the close control without letting the browser scroll the page to
    // reach it — the sheet is fixed-position, so a scroll-into-view here
    // jumps the roster behind it. Restoring the scroll offset on the next
    // frame is the reference's own fix for exactly this.
    const previousScroll = { x: window.scrollX, y: window.scrollY }
    window.requestAnimationFrame(() => {
      closeRef.current?.focus({ preventScroll: true })
      window.scrollTo(previousScroll.x, previousScroll.y)
    })

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const role = roles.find((candidate) => candidate.id === form.roleId) ?? roles[0] ?? null
  const outcome = role ? roleOutcome(role) : null

  function update(patch: Partial<UserFormState>): void {
    setForm((current) => ({ ...current, ...patch }))
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!EMAIL_PATTERN.test(form.email.trim())) {
      setValidationError('Enter a valid email address.')
      return
    }
    if (!form.displayName.trim()) {
      setValidationError('Enter a display name.')
      return
    }
    if (form.password.length < PASSWORD_MIN_LENGTH) {
      setValidationError(`Initial password must contain at least ${PASSWORD_MIN_LENGTH} characters.`)
      return
    }
    setValidationError('')
    void onCreate(form)
  }

  const message = validationError || error

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <aside
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-account-title"
        data-testid="create-account-sheet"
      >
        <Button
          ref={closeRef}
          type="button"
          variant="ghost"
          size="lg"
          shape="pill"
          iconOnly
          className={styles.close}
          aria-label="Close Create account"
          onClick={onClose}
        >
          <FaIcon name="xmark" size={18} />
        </Button>

        <header className={styles.header}>
          <h2 id="create-account-title">Create account</h2>
          <p>Add a person who needs backstage CMS access.</p>
        </header>

        <form className={styles.form} onSubmit={submit} noValidate autoComplete="off">
          <label className={styles.field}>
            <span className={styles.label}>Email address</span>
            <span className={styles.shell}>
              <FaIcon name="envelope" size={15} className={styles.shellGlyph} />
              <Input
                type="email"
                name="new-user-email-address"
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
                value={form.email}
                onChange={(event) => update({ email: event.currentTarget.value })}
              />
            </span>
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Display name</span>
            <span className={styles.shell}>
              <FaIcon name="user" size={15} className={styles.shellGlyph} />
              <Input
                name="new-user-display-name"
                autoComplete="off"
                value={form.displayName}
                onChange={(event) => update({ displayName: event.currentTarget.value })}
              />
            </span>
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Initial password</span>
            <span className={styles.shell}>
              <FaIcon name="lock" size={15} className={styles.shellGlyph} />
              <Input
                type={showPassword ? 'text' : 'password'}
                name="new-user-initial-password"
                autoComplete="new-password"
                data-lpignore="true"
                data-1p-ignore="true"
                minLength={PASSWORD_MIN_LENGTH}
                value={form.password}
                onChange={(event) => update({ password: event.currentTarget.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                iconOnly
                className={styles.reveal}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((current) => !current)}
              >
                <FaIcon name={showPassword ? 'eye-slash' : 'eye'} size={15} />
              </Button>
            </span>
            <small className={styles.hint}>
              At least {PASSWORD_MIN_LENGTH} characters. Share it securely outside the CMS.
            </small>
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Role</span>
            <span className={styles.shell}>
              <FaIcon name="shield-halved" size={15} className={styles.shellGlyph} />
              <Select
                name="new-user-role"
                value={form.roleId}
                menuClassName={styles.selectMenu}
                options={roles.map((candidate) => ({
                  value: candidate.id,
                  label: candidate.name,
                  textValue: candidate.name,
                }))}
                onChange={(event) => update({ roleId: event.currentTarget.value })}
              />
            </span>
          </label>

          {role && outcome && (
            <section className={styles.outcome} aria-label={`${role.name} access`}>
              <span className={styles.outcomeMark}>
                <FaIcon name="user-shield" size={27} />
              </span>
              <div className={styles.outcomeBody}>
                <h3>{role.name} access</h3>
                {outcome.details
                  ? outcome.details.map((detail) => (
                    <p key={detail.text} className={detail.allowed ? styles.allow : styles.deny}>
                      <FaIcon name={detail.allowed ? 'circle-check' : 'circle-xmark'} size={13} />
                      <span>{detail.text}</span>
                    </p>
                  ))
                  : (
                    <>
                      <p className={styles.allow}>
                        <FaIcon name="circle-check" size={13} />
                        <span>{outcome.can}</span>
                      </p>
                      <p className={styles.deny}>
                        <FaIcon name="circle-xmark" size={13} />
                        <span>{outcome.cannot}</span>
                      </p>
                    </>
                  )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={styles.outcomeToggle}
                  aria-expanded={showCapabilities}
                  onClick={() => setShowCapabilities((current) => !current)}
                >
                  <span>View {role.capabilities.length} capabilities</span>
                  <FaIcon name={showCapabilities ? 'chevron-up' : 'chevron-down'} size={11} />
                </Button>
                {showCapabilities && (
                  <ul className={styles.outcomeList}>
                    {role.capabilities.map((capability) => (
                      <li key={capability}>{capability}</li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}

          <p className={styles.startsActive}>
            <span className={styles.startsActiveDot} aria-hidden="true" />
            <span>Account starts active</span>
          </p>

          <p className={styles.stepUpNote}>
            <FaIcon name="shield-halved" size={15} />
            <span>You&rsquo;ll confirm your password before this account is created.</span>
          </p>

          {message && (
            <p className={styles.error} role="alert">
              <FaIcon name="circle-exclamation" size={13} />
              <span>{message}</span>
            </p>
          )}

          <footer className={styles.footer}>
            <Button type="button" variant="secondary" size="lg" disabled={busy} onClick={onClose}>
              <span>Cancel</span>
            </Button>
            <Button type="submit" variant="primary" size="lg" disabled={busy}>
              <FaIcon name="user-plus" size={15} />
              <span>Create account</span>
            </Button>
          </footer>
        </form>
      </aside>
    </div>
  )
}
