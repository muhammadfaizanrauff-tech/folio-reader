import { useCallback, useEffect, useRef, useState } from 'react'
import { listBooks, listProgress, updateBook } from '../storage/db'
import { extraction, useExtractionJobs } from '../extraction/manager'
import type { Book, ReadingProgress } from '../types'

export interface LibraryEntry {
  book: Book
  progress?: ReadingProgress
}

export function useLibrary() {
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const jobs = useExtractionJobs()
  const lastRefresh = useRef(0)

  const refresh = useCallback(async () => {
    try {
      const [books, progress] = await Promise.all([listBooks(), listProgress()])
      const byId = new Map(progress.map((p) => [p.bookId, p]))
      // A book left "extracting" by a closed tab is really paused.
      for (const b of books) {
        if (b.extractionStatus === 'extracting' && !extraction.isRunning(b.id)) {
          b.extractionStatus = 'cancelled'
          updateBook(b.id, { extractionStatus: 'cancelled' }).catch(() => undefined)
        }
      }
      setEntries(books.map((book) => ({ book, progress: byId.get(book.id) })))
      setError(null)
    } catch {
      setError('Your library couldn’t be loaded. Your browser may be blocking local storage (for example in private browsing).')
      setEntries([])
    }
    lastRefresh.current = Date.now()
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    refresh()
  }, [refresh])

  // Refresh (throttled) while extraction jobs report progress.
  useEffect(() => {
    const wait = Math.max(0, 1000 - (Date.now() - lastRefresh.current))
    const t = setTimeout(refresh, wait)
    return () => clearTimeout(t)
  }, [jobs, refresh])

  return { entries, error, refresh }
}
