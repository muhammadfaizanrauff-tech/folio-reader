import { useSyncExternalStore } from 'react'

/**
 * Current reading position, kept outside React state so that scrolling
 * (60 updates/s during auto-scroll) only re-renders the small progress
 * widgets that subscribe to it – never the book content.
 */
export interface Position {
  /** 1-based page at the top of the viewport */
  page: number
  /** 0..1 within that page */
  frac: number
  /** 0..100 through the book */
  percent: number
}

export class PositionStore {
  private value: Position = { page: 1, frac: 0, percent: 0 }
  private listeners = new Set<() => void>()

  get = () => this.value

  set(v: Position) {
    const p = this.value
    if (p.page === v.page && Math.abs(p.frac - v.frac) < 0.0005 && Math.abs(p.percent - v.percent) < 0.005) return
    this.value = v
    this.listeners.forEach((l) => l())
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
}

export function usePosition(store: PositionStore): Position {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

/** Subscribe to a derived value (re-renders only when it changes). */
export function usePositionSelector<T>(store: PositionStore, select: (p: Position) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.get()),
    () => select(store.get()),
  )
}
