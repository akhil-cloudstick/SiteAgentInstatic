import { BRAND_NAME } from '@core/brand'
import styles from './AppLoadingScreen.module.css'

export function AppLoadingScreen() {
  return (
    <div
      className={styles.screen}
      role="status"
      aria-busy="true"
      aria-label={`Loading ${BRAND_NAME}`}
    >
      <BanterLoader />
      {/* The boxes only say "loading" while they move, and the global
          reduced-motion reset stops them dead. The label is what survives —
          see the matching note in index.html's boot loader. */}
      <p className={styles.label}>{`Loading ${BRAND_NAME}…`}</p>
    </div>
  )
}

function BanterLoader() {
  return (
    <div
      className={styles.banterLoader}
      data-loader-spinner="true"
      aria-hidden="true"
    >
      <div className={styles.banterBox} />
      <div className={styles.banterBox} />
      <div className={styles.banterBox} />
      <div className={styles.banterBox} />
      <div className={styles.banterBox} />
      <div className={styles.banterBox} />
      <div className={styles.banterBox} />
      <div className={styles.banterBox} />
      <div className={styles.banterBox} />
    </div>
  )
}
