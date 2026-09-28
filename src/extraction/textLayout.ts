import type { Block, BlockType } from '../types'

/**
 * Turns the positioned text runs that PDF.js returns for a page into readable
 * blocks (headings + paragraphs).
 *
 * Pipeline:  runs → lines → (drop page numbers / isolate running headers)
 *            → paragraphs (gap, indent, short-line and font-size heuristics)
 *            → heading classification (relative font size + common patterns)
 *
 * Pure and synchronous so it can run inside a worker and be unit-tested.
 */

export interface RawItem {
  str: string
  /** PDF.js transform: [a, b, c, d, e, f] */
  transform: number[]
  width: number
  hasEOL?: boolean
}

interface Run {
  str: string
  x: number
  y: number
  w: number
  size: number
  eol: boolean
}

interface Line {
  text: string
  x: number
  xEnd: number
  y: number
  size: number
}

export interface PageLayoutResult {
  blocks: Block[]
  chars: number
  hfTop?: string
  hfBottom?: string
  /** Character-weighted font size histogram for this page (size rounded to 0.5pt → chars). */
  sizeHistogram: Map<number, number>
}

const SENTENCE_END = /[.!?:;…"”’')\]»]$/
const PAGE_NUMBER = /^[\s\-–—]*(page\s+)?(\d{1,4}|[ivxlcdm]{1,7})[\s\-–—]*$/i
const HEADING_WORDS =
  /^(chapter|part|book|section|prologue|epilogue|introduction|preface|foreword|afterword|appendix|contents|table of contents|acknowledg(e)?ments|bibliography|index|glossary|conclusion|summary)\b/i

function median(values: number[]): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))]
}

export function normaliseHeaderKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/\d+/g, '#')
    .replace(/[^\p{L}#]+/gu, ' ')
    .trim()
}

export function histogramMode(hist: Map<number, number>): number {
  let best = 0
  let bestCount = -1
  for (const [size, count] of hist) {
    if (count > bestCount) {
      best = size
      bestCount = count
    }
  }
  return best
}

function toRuns(items: RawItem[]): Run[] {
  const runs: Run[] = []
  for (const it of items) {
    if (typeof it.str !== 'string') continue
    const [a, b, c, d, e, f] = it.transform
    const size = Math.hypot(c, d) || Math.hypot(a, b) || 1
    runs.push({ str: it.str, x: e, y: f, w: it.width || 0, size, eol: !!it.hasEOL })
  }
  return runs
}

function buildLines(runs: Run[]): Line[] {
  const lines: Line[] = []
  let cur: Line | null = null
  let forceBreak = false

  const flush = () => {
    if (cur) {
      cur.text = cur.text.replace(/\s+/g, ' ').trim()
      if (cur.text) lines.push(cur)
    }
    cur = null
  }

  for (const r of runs) {
    if (!r.str) {
      if (r.eol) forceBreak = true
      continue
    }
    if (cur) {
      const c: Line = cur
      const tol = Math.max(c.size, r.size) * 0.55
      const sameLine = !forceBreak && Math.abs(r.y - c.y) <= tol && r.x >= c.xEnd - Math.max(c.size, r.size) * 1.5
      if (!sameLine) {
        flush()
      } else {
        const gap = r.x - c.xEnd
        if (gap > r.size * 0.16 && !c.text.endsWith(' ') && !r.str.startsWith(' ')) c.text += ' '
        c.text += r.str
        c.xEnd = Math.max(c.xEnd, r.x + r.w)
        // Keep the dominant (body) size of the line: weight by string length.
        if (r.str.trim().length > 2 && r.size > c.size * 0.8) c.size = Math.max(c.size, r.size)
      }
    }
    if (!cur) {
      cur = { text: r.str, x: r.x, xEnd: r.x + r.w, y: r.y, size: r.size }
    }
    forceBreak = r.eol
  }
  flush()
  return lines
}

function joinLine(text: string, next: string): string {
  if (!text) return next
  if (text.endsWith('­')) return text.slice(0, -1) + next
  // Rejoin words hyphenated across a line break: "exam-" + "ple" → "example"
  if (/\p{L}-$/u.test(text) && /^\p{Ll}/u.test(next)) return text.slice(0, -1) + next
  if (/[-–—/]$/.test(text)) return text + next
  return text + ' ' + next
}

function classify(text: string, lineCount: number, size: number, bodySize: number): BlockType {
  const len = text.length
  if (len === 0 || len > 160 || lineCount > 3) return 'p'
  const ratio = bodySize > 0 ? size / bodySize : 1
  const endsLikeSentence = /[.,;]$/.test(text) && !/^\d+(\.\d+)*\.$/.test(text)
  if (ratio >= 1.6 && len <= 120) return 'h1'
  if (ratio >= 1.22 && len <= 140 && !endsLikeSentence) return 'h2'
  if (HEADING_WORDS.test(text) && len <= 70 && !endsLikeSentence && ratio >= 0.95) return ratio >= 1.1 ? 'h2' : 'h3'
  const letters = text.replace(/[^\p{L}]/gu, '')
  if (ratio >= 1.08 && len <= 90 && !endsLikeSentence && letters.length >= 3) return 'h3'
  if (letters.length >= 4 && len <= 60 && letters === letters.toUpperCase() && letters !== letters.toLowerCase() && !endsLikeSentence && lineCount === 1 && ratio >= 1)
    return 'h3'
  return 'p'
}

/**
 * @param items     PDF.js text content items for one page
 * @param pageHeight height of the page in PDF units (for header/footer position)
 * @param bookBodySize dominant body font size seen so far in the book (0 if unknown)
 */
export function layoutPage(items: RawItem[], pageHeight: number, bookBodySize = 0): PageLayoutResult {
  const runs = toRuns(items)
  const sizeHistogram = new Map<number, number>()
  for (const r of runs) {
    const n = r.str.trim().length
    if (!n) continue
    const key = Math.round(r.size * 2) / 2
    sizeHistogram.set(key, (sizeHistogram.get(key) ?? 0) + n)
  }

  let lines = buildLines(runs)
  if (!lines.length) return { blocks: [], chars: 0, sizeHistogram }

  const bodySize = bookBodySize || histogramMode(sizeHistogram) || median(lines.map((l) => l.size))

  // --- page numbers & running headers/footers -------------------------------
  const isTopZone = (l: Line) => pageHeight > 0 && l.y > pageHeight * 0.86
  const isBottomZone = (l: Line) => pageHeight > 0 && l.y < pageHeight * 0.14

  // Drop bare page numbers in the first/last two lines.
  lines = lines.filter((l, i) => {
    const edge = i < 2 || i >= lines.length - 2
    return !(edge && PAGE_NUMBER.test(l.text) && (isTopZone(l) || isBottomZone(l) || l.text.length <= 4))
  })
  if (!lines.length) return { blocks: [], chars: 0, sizeHistogram }

  let headerLine: Line | undefined
  let footerLine: Line | undefined
  const first = lines[0]
  if (lines.length > 1 && isTopZone(first) && first.text.length <= 90 && first.y - lines[1].y > first.size * 1.4) {
    headerLine = first
    lines = lines.slice(1)
  }
  const last = lines[lines.length - 1]
  if (lines.length > 1 && isBottomZone(last) && last.text.length <= 90 && lines[lines.length - 2].y - last.y > last.size * 1.4) {
    footerLine = last
    lines = lines.slice(0, -1)
  }

  // --- geometry of the body text -------------------------------------------
  const body = lines.filter((l) => Math.abs(l.size - bodySize) <= bodySize * 0.12)
  const ref = body.length >= 3 ? body : lines
  const leftMargin = percentile(
    ref.map((l) => l.x),
    0.1,
  )
  const rightEdge = percentile(
    ref.map((l) => l.xEnd),
    0.9,
  )
  const textWidth = Math.max(1, rightEdge - leftMargin)
  const gaps: number[] = []
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1]
    const b = lines[i]
    const g = a.y - b.y
    if (g > 0 && g < a.size * 3 && Math.abs(a.size - b.size) < a.size * 0.1) gaps.push(g)
  }
  const typicalGap = median(gaps) || bodySize * 1.3

  // --- paragraphs ------------------------------------------------------------
  interface Para {
    text: string
    lines: number
    sizeSum: number
    charSum: number
  }
  const paras: Para[] = []
  let para: Para | null = null
  let prev: Line | null = null

  for (const line of lines) {
    let brk = !para
    if (para && prev) {
      const gap = prev.y - line.y
      const sizeChange = Math.abs(line.size - prev.size) > Math.max(line.size, prev.size) * 0.14
      const bigGap = gap > typicalGap * 1.45 || gap < -line.size * 0.8
      const indentFromMargin = line.x - leftMargin
      const indent = indentFromMargin > line.size * 0.8 && indentFromMargin < line.size * 6 && prev.x - leftMargin < line.size * 0.5
      const prevShort = prev.xEnd < rightEdge - Math.max(textWidth * 0.18, prev.size * 3)
      const shortBreak = prevShort && (SENTENCE_END.test(prev.text) || /^[\p{Lu}\d"“‘(]/u.test(line.text))
      brk = sizeChange || bigGap || indent || shortBreak
    }
    if (brk) {
      if (para) paras.push(para)
      para = { text: line.text, lines: 1, sizeSum: line.size * line.text.length, charSum: line.text.length }
    } else if (para) {
      para.text = joinLine(para.text, line.text)
      para.lines++
      para.sizeSum += line.size * line.text.length
      para.charSum += line.text.length
    }
    prev = line
  }
  if (para) paras.push(para)

  // --- blocks ------------------------------------------------------------------
  const blocks: Block[] = []
  let pendingDropCap = ''
  for (const p of paras) {
    const text = p.text.trim()
    if (!text) continue
    const size = p.charSum ? p.sizeSum / p.charSum : bodySize
    // A lone oversized letter is almost always a drop cap: merge into the next paragraph.
    if (text.length <= 2 && /^\p{Lu}$/u.test(text.replace(/\W/g, '')) && size > bodySize * 1.5) {
      pendingDropCap = text
      continue
    }
    const merged = pendingDropCap ? pendingDropCap + text : text
    pendingDropCap = ''
    blocks.push({ t: classify(merged, p.lines, size, bodySize), x: merged })
  }
  if (pendingDropCap) blocks.push({ t: 'p', x: pendingDropCap })

  let hfTop: string | undefined
  let hfBottom: string | undefined
  // Header/footer candidates stay on the page as their own block. They are only
  // removed later (see isRemovableHeaderBlock) if the same text repeats on many pages.
  if (headerLine) {
    hfTop = normaliseHeaderKey(headerLine.text)
    blocks.unshift({ t: classify(headerLine.text, 1, headerLine.size, bodySize), x: headerLine.text })
  }
  if (footerLine) {
    hfBottom = normaliseHeaderKey(footerLine.text)
    blocks.push({ t: 'p', x: footerLine.text })
  }

  const chars = blocks.reduce((n, b) => n + b.x.length, 0)
  return { blocks, chars, hfTop, hfBottom, sizeHistogram }
}

/** Large headings (chapter titles) are never treated as running headers, even if they repeat. */
export function isRemovableHeaderBlock(block: Block | undefined): boolean {
  return !!block && block.t !== 'h1' && block.t !== 'h2'
}

/** How often a header/footer key must repeat before it's considered a running header. */
export function runningHeaderThreshold(pageCount: number): number {
  return Math.max(3, Math.round(pageCount * 0.15))
}
