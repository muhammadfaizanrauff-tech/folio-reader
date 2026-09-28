import { useCallback, useEffect, useRef, useState } from 'react'
import type { SearchHit } from '../utils/search'
import { normaliseQuery } from '../utils/search'
import type { SearchRequest, SearchResponse } from '../workers/search.worker'

const MAX_RESULTS = 5000
const DEBOUNCE_MS = 250

export interface SearchState {
  query: string
  /** Normalised query that the current results belong to (used for highlighting). */
  activeQuery: string
  wholeWord: boolean
  hits: SearchHit[]
  index: number
  searching: boolean
  truncated: boolean
  scannedPages: number
}

export function useSearch(bookId: string) {
  const workerRef = useRef<Worker | null>(null)
  const reqId = useRef(0)
  const [state, setState] = useState<SearchState>({
    query: '',
    activeQuery: '',
    wholeWord: false,
    hits: [],
    index: -1,
    searching: false,
    truncated: false,
    scannedPages: 0,
  })

  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      const w = new Worker(new URL('../workers/search.worker.ts', import.meta.url), { type: 'module', name: 'folio-search' })
      w.onmessage = (ev: MessageEvent<SearchResponse>) => {
        const r = ev.data
        if (r.id !== reqId.current) return
        setState((s) => {
          const hits = r.hits.length ? s.hits.concat(r.hits) : s.hits
          return {
            ...s,
            hits,
            index: s.index < 0 && hits.length ? 0 : s.index,
            searching: !r.done,
            truncated: r.truncated,
            scannedPages: r.scannedPages,
          }
        })
      }
      workerRef.current = w
    }
    return workerRef.current
  }, [])

  useEffect(() => () => workerRef.current?.terminate(), [])

  // Debounced search whenever the query or options change.
  useEffect(() => {
    const q = normaliseQuery(state.query)
    const id = ++reqId.current
    if (q.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear results for short queries
      setState((s) => (s.activeQuery || s.hits.length ? { ...s, activeQuery: '', hits: [], index: -1, searching: false, truncated: false } : s))
      return
    }
    const t = setTimeout(() => {
      setState((s) => ({ ...s, activeQuery: q, hits: [], index: -1, searching: true, truncated: false, scannedPages: 0 }))
      const req: SearchRequest = { id, bookId, query: q, wholeWord: state.wholeWord, maxResults: MAX_RESULTS }
      getWorker().postMessage(req)
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [state.query, state.wholeWord, bookId, getWorker])

  const setQuery = useCallback((query: string) => setState((s) => ({ ...s, query })), [])
  const setWholeWord = useCallback((wholeWord: boolean) => setState((s) => ({ ...s, wholeWord })), [])
  const setIndex = useCallback((index: number) => setState((s) => ({ ...s, index })), [])
  const step = useCallback(
    (dir: 1 | -1) =>
      setState((s) => {
        if (!s.hits.length) return s
        return { ...s, index: (s.index + dir + s.hits.length) % s.hits.length }
      }),
    [],
  )
  const clear = useCallback(() => {
    reqId.current++
    setState((s) => ({ ...s, query: '', activeQuery: '', hits: [], index: -1, searching: false, truncated: false }))
  }, [])

  return { ...state, setQuery, setWholeWord, setIndex, step, clear }
}
