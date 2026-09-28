import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Auto-hiding reader controls.
 *
 * - Normal mode: controls appear on any mouse movement and fade after a
 *   period of inactivity (shorter while auto-scrolling).
 * - Fullscreen: controls only appear when the pointer moves near the top or
 *   bottom edge, so moving the mouse over the text never distracts.
 * - Controls never hide while hovered, focused, or while a panel is open.
 */
export function useChrome(opts: { fullscreen: boolean; autoScrolling: boolean; pinned: boolean }) {
  const { fullscreen, autoScrolling, pinned } = opts
  const [visible, setVisible] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hovering = useRef(false)

  const delay = autoScrolling ? 2200 : fullscreen ? 2500 : 4000

  const scheduleHide = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (!hovering.current) setVisible(false)
    }, delay)
  }, [delay])

  const show = useCallback(() => {
    setVisible(true)
    scheduleHide()
  }, [scheduleHide])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      if (fullscreen) {
        const nearEdge = e.clientY < 96 || e.clientY > window.innerHeight - 130
        if (nearEdge) show()
        return
      }
      show()
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [fullscreen, show])

  // Re-arm when mode changes (e.g. auto-scroll starts → fade sooner).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- visibility follows mode changes
    if (fullscreen) setVisible(false)
    else scheduleHide()
    return () => clearTimeout(timer.current)
  }, [fullscreen, autoScrolling, scheduleHide])

  const hoverProps = {
    onPointerEnter: () => {
      hovering.current = true
      setVisible(true)
      clearTimeout(timer.current)
    },
    onPointerLeave: () => {
      hovering.current = false
      scheduleHide()
    },
    onFocus: () => {
      setVisible(true)
      clearTimeout(timer.current)
    },
    onBlur: () => scheduleHide(),
  }

  return { visible: visible || pinned, show, toggle: () => (visible ? setVisible(false) : show()), hoverProps }
}
