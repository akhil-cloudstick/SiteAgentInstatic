import { useEffect, useState } from 'react'

/**
 * Below this width the Site workspace becomes canvas-first: the outline and
 * inspector stop being columns and move into the bottom dock's labelled
 * drawers. 1100px, not the old 900px, because that is where the approved
 * MMSBUILD screen makes the switch — its three-panel editor is never scaled
 * down, it is re-composed.
 */
const NARROW_EDITOR_CHROME_QUERY = '(max-width: 1100px)'

export function isNarrowEditorChromeViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(NARROW_EDITOR_CHROME_QUERY).matches
}

export function useNarrowEditorChrome(): boolean {
  const [matches, setMatches] = useState(isNarrowEditorChromeViewport)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const media = window.matchMedia(NARROW_EDITOR_CHROME_QUERY)
    const update = () => setMatches(media.matches)

    update()
    media.addEventListener('change', update)

    return () => media.removeEventListener('change', update)
  }, [])

  return matches
}
