import { useEffect, useState, useSyncExternalStore } from 'react'
import { getPages } from '../storage/db'
import type { PageRecord } from '../types'

/**
 * Loads extracted pages from IndexedDB on demand and keeps a bounded LRU cache,
 * so the reader only ever holds the pages around the current position in memory.
 */
export class PageStore {
  private cache = new Map<number, PageRecord | null>() // null = not extracted (yet)
  private inflight = new Set<number>()
  private listeners = new Set<() => void>()
  private version = 0
  readonly bookId: string
  private readonly limit: number

  constructor(bookId: string, limit = 160) {
    this.bookId = bookId
    this.limit = limit
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  getVersion = () => this.version

  private notify() {
    this.version++
    this.listeners.forEach((l) => l())
  }

  has(page: number): boolean {
    return this.cache.has(page)
  }

  /** Returns the page if loaded, `null` if it doesn't exist (not extracted), `undefined` if not loaded yet. */
  get(page: number): PageRecord | null | undefined {
    const v = this.cache.get(page)
    if (v !== undefined) {
      // refresh LRU position
      this.cache.delete(page)
      this.cache.set(page, v)
    }
    return v
  }

  /** Ensures pages [from, to] (1-based, inclusive) are loaded. */
  async ensure(from: number, to: number): Promise<void> {
    let lo = -1
    let hi = -1
    for (let p = from; p <= to; p++) {
      if (!this.cache.has(p) && !this.inflight.has(p)) {
        if (lo < 0) lo = p
        hi = p
      }
    }
    if (lo < 0) return
    for (let p = lo; p <= hi; p++) this.inflight.add(p)
    try {
      const pages = await getPages(this.bookId, lo, hi)
      const found = new Map(pages.map((p) => [p.page, p]))
      for (let p = lo; p <= hi; p++) this.cache.set(p, found.get(p) ?? null)
      this.evict(from, to)
      this.notify()
    } finally {
      for (let p = lo; p <= hi; p++) this.inflight.delete(p)
    }
  }

  /** Forget pages that weren't extracted yet so they're re-read (used while extraction is running). */
  invalidateMissing() {
    let changed = false
    for (const [k, v] of this.cache) {
      if (v === null) {
        this.cache.delete(k)
        changed = true
      }
    }
    if (changed) this.notify()
  }

  clear() {
    this.cache.clear()
    this.notify()
  }

  private evict(keepFrom: number, keepTo: number) {
    if (this.cache.size <= this.limit) return
    for (const k of this.cache.keys()) {
      if (this.cache.size <= this.limit) break
      if (k >= keepFrom && k <= keepTo) continue
      this.cache.delete(k)
    }
  }
}

export function usePageStore(bookId: string): PageStore {
  const [store, setStore] = useState(() => new PageStore(bookId))
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- replace the cache when the book changes
    if (store.bookId !== bookId) setStore(new PageStore(bookId))
  }, [bookId, store])
  useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion)
  return store
}
