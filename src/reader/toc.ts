import { useMemo } from 'react'
import type { Book, TocEntry } from '../types'

/** Index of the TOC entry that contains `page` (last entry starting at or before it). */
export function currentTocIndex(toc: TocEntry[], page: number): number {
  let lo = 0
  let hi = toc.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (toc[mid].page <= page) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

export function useSortedToc(book: Book): TocEntry[] {
  return useMemo(() => [...book.toc].sort((a, b) => a.page - b.page || (a.block ?? 0) - (b.block ?? 0)), [book.toc])
}
