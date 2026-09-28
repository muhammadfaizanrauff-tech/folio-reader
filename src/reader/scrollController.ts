import { useSyncExternalStore } from 'react'

/**
 * Owns the scroll position of a reader viewport.
 *
 * Programmatic scroll changes (virtual-list anchoring, jumps, auto-scroll) go
 * through `setTop` so we always know which scroll positions *we* wrote. Any
 * other change is the user scrolling manually, which pauses auto-scroll.
 *
 * Auto-scroll keeps a floating-point position. The integer part is applied to
 * `scrollTop`; the fractional remainder is applied as a sub-pixel transform on
 * the content, so even very slow speeds (a few px/s) move continuously instead
 * of stepping one whole pixel at a time.
 */

export type AutoScrollState = 'idle' | 'running' | 'paused'
export type PauseReason = 'user' | 'manual' | 'end' | 'hidden' | null

export interface AutoScrollSnapshot {
  state: AutoScrollState
  reason: PauseReason
}

const MANUAL_THRESHOLD_PX = 2.5
const RAMP_MS = 650

export class ScrollController {
  el: HTMLElement | null = null
  content: HTMLElement | null = null

  private pos = 0
  private lastWritten = -1
  private raf = 0
  private lastTs = 0
  private rampStart = 0
  private snapshot: AutoScrollSnapshot = { state: 'idle', reason: null }
  private listeners = new Set<() => void>()
  private detach: (() => void) | null = null
  private userScrollListeners = new Set<() => void>()

  /** Notified when the user scrolls by hand (wheel, touch, keys, scrollbar). */
  onUserScroll(l: () => void) {
    this.userScrollListeners.add(l)
    return () => {
      this.userScrollListeners.delete(l)
    }
  }

  /** Current speed in CSS px / second. Can be changed while running. */
  private speed = 36

  setSpeed(pxPerSecond: number) {
    this.speed = pxPerSecond
  }

  attach(el: HTMLElement | null, content: HTMLElement | null) {
    this.detach?.()
    this.detach = null
    this.el = el
    this.content = content
    if (!el) return

    const onUserInput = () => {
      if (this.snapshot.state === 'running') this.pause('manual')
      this.userScrollListeners.forEach((l) => l())
    }
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) onUserInput()
    }
    const onPointerDown = (e: PointerEvent) => {
      // Pointer down on the scroller itself (not its content) = scrollbar drag.
      if (e.target === el) onUserInput()
    }
    el.addEventListener('wheel', onUserInput, { passive: true })
    el.addEventListener('touchstart', onUserInput, { passive: true })
    el.addEventListener('keydown', onKey)
    el.addEventListener('pointerdown', onPointerDown)
    this.detach = () => {
      el.removeEventListener('wheel', onUserInput)
      el.removeEventListener('touchstart', onUserInput)
      el.removeEventListener('keydown', onKey)
      el.removeEventListener('pointerdown', onPointerDown)
    }
  }

  // ---------- position ----------

  get top(): number {
    return this.el?.scrollTop ?? 0
  }

  /** Programmatic scroll that must not be interpreted as user input. */
  setTop(v: number) {
    const el = this.el
    if (!el) return
    const max = Math.max(0, el.scrollHeight - el.clientHeight)
    this.pos = Math.min(max, Math.max(0, v))
    this.write()
  }

  /** Shift by a delta (used when content above the viewport changes size). */
  adjust(delta: number) {
    if (!this.el || !delta) return
    this.setTop(this.currentPos() + delta)
  }

  private currentPos(): number {
    const el = this.el
    if (!el) return 0
    // If someone else scrolled since our last write, adopt the real position.
    return Math.abs(el.scrollTop - this.lastWritten) > MANUAL_THRESHOLD_PX ? el.scrollTop : this.pos
  }

  private write() {
    const el = this.el
    if (!el) return
    const whole = Math.floor(this.pos)
    el.scrollTop = whole
    this.lastWritten = el.scrollTop
    const frac = this.snapshot.state === 'running' ? this.pos - el.scrollTop : 0
    if (this.content) this.content.style.transform = frac > 0.01 && frac < 1 ? `translate3d(0, ${-frac}px, 0)` : ''
  }

  // ---------- auto-scroll ----------

  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  getSnapshot = () => this.snapshot

  private setState(state: AutoScrollState, reason: PauseReason) {
    if (this.snapshot.state === state && this.snapshot.reason === reason) return
    this.snapshot = { state, reason }
    this.listeners.forEach((l) => l())
  }

  get state(): AutoScrollState {
    return this.snapshot.state
  }

  start() {
    const el = this.el
    if (!el) return
    if (this.atEnd()) return
    this.pos = el.scrollTop
    this.lastWritten = el.scrollTop
    this.lastTs = 0
    this.rampStart = performance.now()
    this.setState('running', null)
    if (this.content) this.content.style.willChange = 'transform'
    cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(this.tick)
  }

  resume() {
    this.start()
  }

  pause(reason: PauseReason = 'user') {
    if (this.snapshot.state !== 'running') return
    cancelAnimationFrame(this.raf)
    this.settle()
    this.setState('paused', reason)
  }

  stop() {
    cancelAnimationFrame(this.raf)
    this.settle()
    this.setState('idle', null)
  }

  toggle() {
    if (this.snapshot.state === 'running') this.pause('user')
    else this.start()
  }

  /** Snap to a whole pixel and remove the sub-pixel transform. */
  private settle() {
    if (this.content) {
      this.content.style.transform = ''
      this.content.style.willChange = ''
    }
  }

  private atEnd(): boolean {
    const el = this.el
    if (!el) return true
    return el.scrollTop + el.clientHeight >= el.scrollHeight - 1
  }

  private tick = (ts: number) => {
    const el = this.el
    if (!el || this.snapshot.state !== 'running') return

    // Anything that moved the viewport besides us (scrollbar drag, find-in-page,
    // keyboard focus changes) counts as manual scrolling.
    if (this.lastWritten >= 0 && Math.abs(el.scrollTop - this.lastWritten) > MANUAL_THRESHOLD_PX) {
      this.pause('manual')
      return
    }

    if (this.lastTs) {
      // Clamp dt so a background tab or a long frame doesn't cause a jump.
      const dt = Math.min(ts - this.lastTs, 100) / 1000
      const t = Math.min(1, (ts - this.rampStart) / RAMP_MS)
      const ramp = t * t * (3 - 2 * t) // smoothstep ease-in
      this.pos += this.speed * dt * ramp
      const max = el.scrollHeight - el.clientHeight
      if (this.pos >= max) {
        this.pos = max
        this.write()
        cancelAnimationFrame(this.raf)
        this.settle()
        this.setState('paused', 'end')
        return
      }
      this.write()
    }
    this.lastTs = ts
    this.raf = requestAnimationFrame(this.tick)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.detach?.()
    this.listeners.clear()
  }
}

export function useAutoScrollState(c: ScrollController): AutoScrollSnapshot {
  return useSyncExternalStore(c.subscribe, c.getSnapshot, c.getSnapshot)
}
