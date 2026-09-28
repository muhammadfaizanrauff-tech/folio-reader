import { useSyncExternalStore } from 'react'

/** Tiny hash router so a reload keeps you in the book you were reading. */
export type Route = { name: 'library' } | { name: 'processing'; bookId: string } | { name: 'reader'; bookId: string }

function parse(hash: string): Route {
  const m = hash.replace(/^#\/?/, '').split('/')
  if (m[0] === 'read' && m[1]) return { name: 'reader', bookId: decodeURIComponent(m[1]) }
  if (m[0] === 'processing' && m[1]) return { name: 'processing', bookId: decodeURIComponent(m[1]) }
  return { name: 'library' }
}

export function routeHash(r: Route): string {
  switch (r.name) {
    case 'reader':
      return `#/read/${encodeURIComponent(r.bookId)}`
    case 'processing':
      return `#/processing/${encodeURIComponent(r.bookId)}`
    default:
      return '#/'
  }
}

let current = parse(location.hash)
const listeners = new Set<() => void>()
window.addEventListener('hashchange', () => {
  current = parse(location.hash)
  listeners.forEach((l) => l())
})

export function navigate(r: Route, replace = false) {
  const h = routeHash(r)
  if (location.hash === h) return
  if (replace) history.replaceState(null, '', h)
  else history.pushState(null, '', h)
  current = r
  listeners.forEach((l) => l())
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}
