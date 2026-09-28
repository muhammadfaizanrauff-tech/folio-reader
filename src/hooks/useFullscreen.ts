import { useCallback, useEffect, useState } from 'react'

/**
 * Fullscreen via the Fullscreen API, with a "focus mode" fallback for browsers
 * that don't allow element fullscreen (e.g. iPhone Safari): the UI is hidden
 * the same way, only the browser chrome stays.
 */
export function useFullscreen() {
  const supported = typeof document !== 'undefined' && !!document.documentElement.requestFullscreen && document.fullscreenEnabled !== false
  const [native, setNative] = useState(() => !!document.fullscreenElement)
  const [pseudo, setPseudo] = useState(false)

  useEffect(() => {
    const onChange = () => setNative(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const enter = useCallback(async () => {
    if (supported) {
      try {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
        return
      } catch {
        // fall through to focus mode
      }
    }
    setPseudo(true)
  }, [supported])

  const exit = useCallback(async () => {
    setPseudo(false)
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined)
  }, [])

  const isFullscreen = native || pseudo
  const toggle = useCallback(() => (isFullscreen ? exit() : enter()), [isFullscreen, enter, exit])

  // Leaving the reader always leaves fullscreen.
  useEffect(
    () => () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined)
    },
    [],
  )

  return { isFullscreen, isPseudo: pseudo, enter, exit, toggle }
}
