/**
 * Text matching shared by the search worker (to find results) and the reader
 * (to highlight them), so both always agree on match positions.
 * Case-insensitive; `toLowerCase` keeps string offsets aligned for practically
 * all scripts used in books.
 */
export interface SearchOptions {
  wholeWord: boolean
}

const WORD = /[\p{L}\p{N}_]/u

export function normaliseQuery(q: string): string {
  return q.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** Returns start offsets of all matches of `query` (already normalised) in `text`. */
export function findMatches(text: string, query: string, opts: SearchOptions, limit = Infinity): number[] {
  if (!query) return []
  const hay = text.toLowerCase()
  const out: number[] = []
  let from = 0
  while (out.length < limit) {
    const i = hay.indexOf(query, from)
    if (i < 0) break
    if (!opts.wholeWord || ((i === 0 || !WORD.test(hay[i - 1])) && (i + query.length >= hay.length || !WORD.test(hay[i + query.length])))) {
      out.push(i)
    }
    from = i + Math.max(1, query.length)
  }
  return out
}

export interface SearchHit {
  page: number
  block: number
  start: number
  length: number
  before: string
  match: string
  after: string
}

export function makeSnippet(text: string, start: number, length: number, context = 48): Pick<SearchHit, 'before' | 'match' | 'after'> {
  let b = Math.max(0, start - context)
  let a = Math.min(text.length, start + length + context)
  // Snap to word boundaries for a cleaner snippet.
  if (b > 0) {
    const sp = text.indexOf(' ', b)
    if (sp > 0 && sp < start) b = sp + 1
  }
  if (a < text.length) {
    const sp = text.lastIndexOf(' ', a)
    if (sp > start + length) a = sp
  }
  return {
    before: (b > 0 ? '…' : '') + text.slice(b, start),
    match: text.slice(start, start + length),
    after: text.slice(start + length, a) + (a < text.length ? '…' : ''),
  }
}
