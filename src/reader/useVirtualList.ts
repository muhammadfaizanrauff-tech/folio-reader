/* eslint-disable react-hooks/refs, react-hooks/exhaustive-deps --
 * The virtualiser keeps its layout model (heights, prefix sums, anchor) in a
 * mutable ref on purpose: it is updated from layout effects, ResizeObserver
 * callbacks and scroll events many times per second, and React state would
 * add a render per measurement. Renders read a consistent snapshot of it and
 * `setVersion` is used to request a re-render when it changes. The layout
 * effect intentionally runs after every render (no dependency list) because
 * that is exactly when new items may need measuring; it only sets state when
 * something actually changed, so it converges. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { ScrollController } from './scrollController'

/**
 * Variable-height list virtualisation with scroll anchoring.
 *
 * - Every item (a book page) has a height: measured once rendered, otherwise
 *   estimated. Estimates are self-calibrating: the ratio between measured and
 *   estimated heights is applied to the pages that haven't been seen yet.
 * - Only items within `overscan` px of the viewport are rendered; the rest of
 *   the scroll height is padding.
 * - Whenever heights change (first render of a page, font change, resize), the
 *   reading position is re-anchored to "page N, fraction F", so the text you're
 *   looking at doesn't jump. All corrections happen in layout effects /
 *   ResizeObserver callbacks, i.e. before the browser paints.
 */

export interface Anchor {
  index: number
  frac: number
}

export interface VirtualListOptions {
  count: number
  estimate: (index: number) => number
  /** Change when layout parameters change (font, width…) – invalidates all measurements. */
  layoutKey: string
  /** Change when the estimate function changes but measurements stay valid. */
  estimateKey?: string | number
  controller: ScrollController
  overscan?: number
  initialAnchor?: Anchor | null
  /**
   * Reports the anchor at the top edge (used to save/restore the position) and
   * at the reading line (used for the displayed page: the top edge is under the toolbar).
   */
  onScrollPosition?: (top: Anchor, reading: Anchor) => void
}

interface EngineState {
  count: number
  heights: Float64Array
  measured: Uint8Array
  prefix: Float64Array
  dirty: boolean
  measuredSum: number
  estimatedSum: number
  ratio: number
  layoutKey: string
  estimateKey: string | number | undefined
  pendingAnchor: Anchor | null
  items: Map<number, HTMLElement>
}

/** Where the eye rests: a little below the top edge (which sits under the top toolbar). */
export function readingLine(el: HTMLElement): number {
  return Math.min(140, el.clientHeight * 0.18)
}

function createState(count: number, layoutKey: string, estimateKey: string | number | undefined): EngineState {
  return {
    count,
    heights: new Float64Array(count),
    measured: new Uint8Array(count),
    prefix: new Float64Array(count + 1),
    dirty: true,
    measuredSum: 0,
    estimatedSum: 0,
    ratio: 1,
    layoutKey,
    estimateKey,
    pendingAnchor: null,
    items: new Map(),
  }
}

export function useVirtualList(opts: VirtualListOptions) {
  const { count, estimate, layoutKey, estimateKey, controller, overscan = 1400 } = opts
  const stRef = useRef<EngineState | null>(null)
  const estimateRef = useRef(estimate)
  estimateRef.current = estimate
  const onPosRef = useRef(opts.onScrollPosition)
  onPosRef.current = opts.onScrollPosition

  const [range, setRange] = useState<{ start: number; end: number }>({ start: 0, end: Math.min(count, 3) - 1 })
  const [, setVersion] = useState(0)

  // ---- engine helpers (operate on the mutable state) ----
  const reestimate = useCallback((st: EngineState, onlyUnmeasured: boolean) => {
    const est = estimateRef.current
    for (let i = 0; i < st.count; i++) {
      if (onlyUnmeasured && st.measured[i]) continue
      st.heights[i] = Math.max(1, est(i) * st.ratio)
    }
    st.dirty = true
  }, [])

  if (!stRef.current || stRef.current.count !== count) {
    const prev = stRef.current
    const st = createState(count, layoutKey, estimateKey)
    if (prev) {
      st.items = prev.items
      st.pendingAnchor = prev.pendingAnchor
    } else if (opts.initialAnchor) {
      st.pendingAnchor = opts.initialAnchor
    }
    reestimate(st, false)
    stRef.current = st
  }
  const st = stRef.current

  const ensurePrefix = useCallback((s: EngineState) => {
    if (!s.dirty) return
    let acc = 0
    s.prefix[0] = 0
    for (let i = 0; i < s.count; i++) {
      acc += s.heights[i]
      s.prefix[i + 1] = acc
    }
    s.dirty = false
  }, [])

  const indexAt = useCallback(
    (s: EngineState, y: number): number => {
      ensurePrefix(s)
      if (s.count === 0) return 0
      let lo = 0
      let hi = s.count - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (s.prefix[mid] <= y) lo = mid
        else hi = mid - 1
      }
      return lo
    },
    [ensurePrefix],
  )

  const anchorAt = useCallback(
    (s: EngineState, y: number): Anchor => {
      // +1px: scrollTop is floored to whole pixels, so a jump to the exact top of
      // page N lands a fraction of a pixel inside page N-1.
      const index = indexAt(s, y + 1)
      const h = s.heights[index] || 1
      return { index, frac: Math.min(1, Math.max(0, (y - s.prefix[index]) / h)) }
    },
    [indexAt],
  )

  const offsetOf = useCallback(
    (s: EngineState, a: Anchor): number => {
      ensurePrefix(s)
      const i = Math.min(Math.max(0, a.index), Math.max(0, s.count - 1))
      return s.prefix[i] + (s.heights[i] || 0) * a.frac
    },
    [ensurePrefix],
  )

  const computeRange = useCallback(
    (s: EngineState, top: number, viewport: number) => {
      if (s.count === 0) return { start: 0, end: -1 }
      const start = indexAt(s, Math.max(0, top - overscan))
      const end = indexAt(s, top + viewport + overscan)
      return { start, end }
    },
    [indexAt, overscan],
  )

  const rangeRef = useRef(range)
  rangeRef.current = range

  const updateRange = useCallback(() => {
    const s = stRef.current
    const el = controller.el
    if (!s || !el) return
    const r = computeRange(s, el.scrollTop, el.clientHeight)
    const cur = rangeRef.current
    if (r.start !== cur.start || r.end !== cur.end) {
      rangeRef.current = r
      setRange(r)
    }
  }, [computeRange, controller])

  // ---- measurement + anchoring, before every paint ----
  useLayoutEffect(() => {
    const s = stRef.current
    const el = controller.el
    if (!s || !el) return

    ensurePrefix(s)
    const oldTop = el.scrollTop
    // Where the reader is, expressed with the heights that produced the current scrollTop.
    const anchor = s.pendingAnchor ?? anchorAt(s, oldTop)
    let changed = false

    if (s.layoutKey !== layoutKey) {
      s.layoutKey = layoutKey
      s.measured.fill(0)
      s.measuredSum = 0
      s.estimatedSum = 0
      s.ratio = 1
      reestimate(s, false)
      changed = true
    } else if (s.estimateKey !== estimateKey) {
      s.estimateKey = estimateKey
      reestimate(s, true)
      changed = true
    }

    const est = estimateRef.current
    for (const [i, node] of s.items) {
      if (i >= s.count) continue
      const h = node.getBoundingClientRect().height
      if (!h) continue
      if (!s.measured[i]) {
        s.measured[i] = 1
        s.measuredSum += h
        s.estimatedSum += Math.max(1, est(i))
        s.heights[i] = h
        changed = true
      } else if (Math.abs(h - s.heights[i]) > 0.5) {
        s.measuredSum += h - s.heights[i]
        s.heights[i] = h
        changed = true
      }
    }
    if (changed && s.estimatedSum > 0) {
      const ratio = s.measuredSum / s.estimatedSum
      if (Math.abs(ratio - s.ratio) / s.ratio > 0.02) {
        s.ratio = ratio
        reestimate(s, true)
      }
    }

    if (changed) {
      // Spacers are stale: re-render first, then restore the anchor on the next pass.
      s.dirty = true
      s.pendingAnchor = anchor
      setVersion((v) => v + 1)
      const r = computeRange(s, offsetOf(s, anchor), el.clientHeight)
      rangeRef.current = r
      setRange(r)
      return
    }

    s.pendingAnchor = null
    const target = offsetOf(s, anchor)
    if (Math.abs(target - oldTop) > 0.5) controller.setTop(target)
    updateRange()
  })

  // Items that change size outside a React render (web fonts loading, container resize).
  const roRef = useRef<ResizeObserver | null>(null)
  if (!roRef.current && typeof ResizeObserver !== 'undefined') {
    roRef.current = new ResizeObserver((entries) => {
      const s = stRef.current
      if (!s) return
      const needs = entries.some((e) => {
        const i = Number((e.target as HTMLElement).dataset.index)
        const h = (e.target as HTMLElement).getBoundingClientRect().height
        return !s.measured[i] || Math.abs(h - s.heights[i]) > 0.5
      })
      if (needs) flushSync(() => setVersion((v) => v + 1))
    })
  }
  useEffect(() => () => roRef.current?.disconnect(), [])

  /** Attach to each rendered item; requires a `data-index` attribute. */
  const itemRef = useCallback((node: HTMLElement | null) => {
    if (!node) return
    const i = Number(node.dataset.index)
    const s = stRef.current
    s?.items.set(i, node)
    roRef.current?.observe(node)
    return () => {
      if (stRef.current?.items.get(i) === node) stRef.current.items.delete(i)
      roRef.current?.unobserve(node)
    }
  }, [])

  // Scroll listener: update the rendered window + report position.
  useEffect(() => {
    const el = controller.el
    if (!el) return
    let raf = 0
    const onScroll = () => {
      updateRange()
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0
          const s = stRef.current
          if (s && onPosRef.current) onPosRef.current(anchorAt(s, el.scrollTop), anchorAt(s, el.scrollTop + readingLine(el)))
        })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(() => updateRange())
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [controller, controller.el, updateRange, anchorAt])

  // ---- public API ----
  const scrollToAnchor = useCallback(
    (a: Anchor) => {
      const s = stRef.current
      const el = controller.el
      if (!s || !el) return
      const anchor = { index: Math.min(Math.max(0, a.index), s.count - 1), frac: Math.min(1, Math.max(0, a.frac)) }
      s.pendingAnchor = anchor
      const r = computeRange(s, offsetOf(s, anchor), el.clientHeight)
      rangeRef.current = r
      setRange(r)
      setVersion((v) => v + 1)
    },
    [computeRange, controller, offsetOf],
  )

  const getAnchor = useCallback((): Anchor => {
    const s = stRef.current
    const el = controller.el
    if (!s || !el) return { index: 0, frac: 0 }
    if (s.pendingAnchor) return s.pendingAnchor
    return anchorAt(s, el.scrollTop)
  }, [anchorAt, controller])

  ensurePrefix(st)
  const start = Math.min(range.start, Math.max(0, count - 1))
  const end = Math.min(range.end, count - 1)
  const total = st.prefix[count] ?? 0
  const padTop = count ? st.prefix[start] : 0
  const padBottom = count && end >= start ? total - st.prefix[end + 1] : 0

  return { start, end, padTop, padBottom, total, itemRef, scrollToAnchor, getAnchor }
}
