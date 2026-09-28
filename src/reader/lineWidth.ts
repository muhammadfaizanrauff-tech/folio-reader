import { useCallback, useSyncExternalStore } from 'react'
import { fontStack, getSettings, LIMITS, updateSettings, useSettings } from '../storage/settings'

/**
 * Line width expressed the way readers think about it: words per line.
 *
 * The setting itself is stored in px (`readingWidth`), but the UI converts to
 * and from words using the real width of an average word in the current font
 * and size (measured with a canvas), so "14 words per line" is accurate for
 * Georgia at 18px as well as Inter at 24px.
 */

/** Side padding around the text column (each side), shared with TextReader. */
export const GUTTER = 28

// Default sample; replaced with real text from the open book (see setSampleText),
// so the words-per-line figure matches that book's vocabulary.
let sample =
  'The evening light fell across the pages of the old book while she read on, turning each page slowly and ' +
  'listening to the quiet sound of the rain against the window of the little room at the top of the house '
let sampleWords = sample.trim().split(/\s+/).length

const cache = new Map<string, number>()
let ctx: CanvasRenderingContext2D | null = null

/** Average width of one word (including the following space) in px. */
export function pxPerWord(fontId: string, fontSize: number): number {
  const key = `${fontId}|${fontSize}`
  let v = cache.get(key)
  if (v === undefined) {
    ctx ??= document.createElement('canvas').getContext('2d')
    if (ctx) {
      ctx.font = `${fontSize}px ${fontStack(fontId)}`
      v = ctx.measureText(sample + ' ').width / sampleWords
    } else {
      v = fontSize * 2.9
    }
    cache.set(key, v)
  }
  return v
}

/** Widest text column the current window allows. */
export function availableWidth(): number {
  return Math.max(260, (typeof window === 'undefined' ? 1200 : window.innerWidth) - GUTTER * 2)
}

// Re-measure when web fonts finish loading or the window is resized.
let version = 0
const listeners = new Set<() => void>()
function bump() {
  cache.clear()
  version++
  listeners.forEach((l) => l())
}
if (typeof window !== 'undefined') {
  window.addEventListener('resize', bump)
  document.fonts?.addEventListener?.('loadingdone', bump)
}
function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Use real prose from the current book for measuring (called by the reader). */
export function setSampleText(text: string) {
  const clean = text.replace(/\s+/g, ' ').trim()
  const words = clean.split(' ').length
  if (words < 40 || clean === sample) return
  sample = clean
  sampleWords = words
  bump()
}

export const MIN_WORDS = 5

export function useLineWidth() {
  useSyncExternalStore(subscribe, () => version, () => version)
  const s = useSettings()
  const perWord = pxPerWord(s.fontFamily, s.fontSize)
  const available = availableWidth()
  const effective = Math.min(s.readingWidth, available)
  const words = Math.max(1, Math.round(effective / perWord))
  const maxWords = Math.max(MIN_WORDS, Math.floor(available / perWord))
  const isFull = s.readingWidth >= available - 1

  const setWords = useCallback((w: number) => {
    const cur = getSettings()
    const pw = pxPerWord(cur.fontFamily, cur.fontSize)
    const avail = availableWidth()
    const target = Math.round(Math.max(MIN_WORDS, w) * pw)
    // Past the window's width means "full width": store the maximum so it keeps filling the screen on resize.
    const px = target >= avail ? LIMITS.readingWidth.max : target
    updateSettings({ readingWidth: Math.min(LIMITS.readingWidth.max, Math.max(LIMITS.readingWidth.min, px)) })
  }, [])

  const step = useCallback(
    (dir: 1 | -1) => {
      if (dir > 0 && isFull) return
      setWords(words + dir)
    },
    [isFull, setWords, words],
  )

  const setFull = useCallback(() => updateSettings({ readingWidth: LIMITS.readingWidth.max }), [])

  return { words, maxWords, isFull, setWords, step, setFull }
}
