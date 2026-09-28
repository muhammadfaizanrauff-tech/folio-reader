/// <reference lib="webworker" />
/**
 * Full-text search over a book, streaming pages from IndexedDB with a cursor so
 * the whole book is never loaded at once. Results are posted in batches so the
 * UI can show them while the search is still running. A newer query id cancels
 * the running search.
 */
import { getDB, pageRange } from '../storage/db'
import { findMatches, makeSnippet, normaliseQuery, type SearchHit } from '../utils/search'

declare const self: DedicatedWorkerGlobalScope

export interface SearchRequest {
  id: number
  bookId: string
  query: string
  wholeWord: boolean
  maxResults: number
}

export interface SearchResponse {
  id: number
  hits: SearchHit[]
  done: boolean
  truncated: boolean
  scannedPages: number
}

let currentId = 0

self.onmessage = (ev: MessageEvent<SearchRequest>) => {
  currentId = ev.data.id
  run(ev.data).catch(() => self.postMessage({ id: ev.data.id, hits: [], done: true, truncated: false, scannedPages: 0 } satisfies SearchResponse))
}

async function run(req: SearchRequest) {
  const query = normaliseQuery(req.query)
  if (!query) {
    self.postMessage({ id: req.id, hits: [], done: true, truncated: false, scannedPages: 0 } satisfies SearchResponse)
    return
  }
  const db = await getDB()
  let batch: SearchHit[] = []
  let total = 0
  let scanned = 0
  let truncated = false
  let lastPost = performance.now()

  let cursor = await db.transaction('pages').store.openCursor(pageRange(req.bookId))
  while (cursor) {
    if (req.id !== currentId) return // superseded
    const rec = cursor.value
    scanned++
    for (let b = 0; b < rec.blocks.length && !truncated; b++) {
      const text = rec.blocks[b].x
      for (const start of findMatches(text, query, { wholeWord: req.wholeWord })) {
        batch.push({ page: rec.page, block: b, start, length: query.length, ...makeSnippet(text, start, query.length) })
        if (++total >= req.maxResults) {
          truncated = true
          break
        }
      }
    }
    if (truncated) break
    const now = performance.now()
    if (batch.length && now - lastPost > 120) {
      self.postMessage({ id: req.id, hits: batch, done: false, truncated: false, scannedPages: scanned } satisfies SearchResponse)
      batch = []
      lastPost = now
    }
    cursor = await cursor.continue()
  }
  if (req.id !== currentId) return
  self.postMessage({ id: req.id, hits: batch, done: true, truncated, scannedPages: scanned } satisfies SearchResponse)
}
