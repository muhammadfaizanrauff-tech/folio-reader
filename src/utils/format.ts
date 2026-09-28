const nf = new Intl.NumberFormat()

export const formatNumber = (n: number) => nf.format(Math.round(n))

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return ''
  if (seconds < 10) return 'a few seconds'
  if (seconds < 60) return `${Math.round(seconds / 5) * 5} seconds`
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return `${h} hr${rm ? ` ${rm} min` : ''}`
}

const rtf = typeof Intl.RelativeTimeFormat === 'function' ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }) : null

export function formatRelativeTime(ts: number): string {
  const diff = (ts - Date.now()) / 1000
  const abs = Math.abs(diff)
  if (!rtf) return new Date(ts).toLocaleDateString()
  if (abs < 60) return 'just now'
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day')
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Rough reading time using ~1,300 characters per minute (~250 wpm). */
export function readingMinutes(chars: number): number {
  return chars / 1300
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

export function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el || !el.tagName) return false
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type
    // Range sliders shouldn't swallow reader shortcuts like Space.
    return !['range', 'checkbox', 'radio', 'button', 'submit'].includes(type)
  }
  return el.isContentEditable
}
