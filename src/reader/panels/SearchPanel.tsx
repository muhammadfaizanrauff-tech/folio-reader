import { useEffect, useRef } from 'react'
import { Drawer } from './Drawer'
import { IconButton, Toggle } from '../../components/ui'
import { cx } from '../../utils/cx'
import { Icon } from '../../components/Icon'
import { formatNumber } from '../../utils/format'
import type { useSearch } from '../useSearch'

const LIST_LIMIT = 500

interface Props {
  open: boolean
  onClose: () => void
  search: ReturnType<typeof useSearch>
  extractedPages: number
  pageCount: number
}

export function SearchPanel({ open, onClose, search, extractedPages, pageCount }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const { query, hits, index, searching, truncated, activeQuery, wholeWord, scannedPages } = search

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.select(), 80)
      return () => clearTimeout(t)
    }
  }, [open])

  useEffect(() => {
    const item = listRef.current?.querySelector<HTMLElement>(`[data-hit="${index}"]`)
    const box = listRef.current?.closest<HTMLElement>('.overflow-y-auto')
    if (item && box) {
      const top = item.getBoundingClientRect().top - box.getBoundingClientRect().top
      if (top < 120 || top + item.offsetHeight > box.clientHeight) box.scrollTop += top - box.clientHeight / 3
    }
  }, [index])

  const count = hits.length
  let status = ''
  if (activeQuery) {
    if (searching) status = `Searching… ${formatNumber(count)} found (page ${formatNumber(scannedPages)} of ${formatNumber(extractedPages)})`
    else if (!count) status = 'No matches'
    else status = `${truncated ? `${formatNumber(count)}+` : formatNumber(count)} match${count === 1 ? '' : 'es'}`
  } else if (query.trim().length === 1) status = 'Type at least 2 characters'

  return (
    <Drawer open={open} side="right" title="Search" onClose={onClose} width={380}>
      <div className="sticky top-0 z-10 -mx-5 bg-panel px-5 pb-3">
        <div className="flex items-center gap-2 rounded-full border border-line-strong bg-paper px-3 focus-within:border-accent">
          <Icon name="search" size={16} className="text-ink-faint" />
          <input
            ref={inputRef}
            data-autofocus
            type="search"
            value={query}
            onChange={(e) => search.setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                search.step(e.shiftKey ? -1 : 1)
              }
            }}
            placeholder="Search this book"
            aria-label="Search this book"
            className="h-10 min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-faint"
          />
          {query && <IconButton icon="x" label="Clear search" tip={false} size="sm" onClick={search.clear} />}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <p className="flex-1 text-[12px] text-ink-soft" aria-live="polite">
            {count > 0 && index >= 0 && !searching ? `${formatNumber(index + 1)} of ` : ''}
            {status}
          </p>
          <IconButton icon="chevron-up" label="Previous match (Shift+Enter)" size="sm" disabled={!count} onClick={() => search.step(-1)} tipPos="bottom" />
          <IconButton icon="chevron-down" label="Next match (Enter)" size="sm" disabled={!count} onClick={() => search.step(1)} tipPos="bottom" />
        </div>
        <div className="mt-2">
          <Toggle label="Whole words only" checked={wholeWord} onChange={search.setWholeWord} />
        </div>
        {extractedPages < pageCount && (
          <p className="mt-2 text-[12px] text-ink-faint">Searching the {formatNumber(extractedPages)} pages extracted so far.</p>
        )}
      </div>

      <ol ref={listRef} className="-mx-2 mt-1 space-y-0.5">
        {hits.slice(0, LIST_LIMIT).map((h, i) => (
          <li key={`${h.page}-${h.block}-${h.start}`}>
            <button
              type="button"
              data-hit={i}
              onClick={() => search.setIndex(i)}
              aria-current={i === index ? 'true' : undefined}
              className={cx('w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-hover', i === index && 'bg-accent-soft')}
            >
              <span className="mb-0.5 block text-[11px] font-medium tabular-nums text-ink-faint">Page {formatNumber(h.page)}</span>
              <span className="block text-[13px] leading-snug text-ink-soft">
                {h.before}
                <mark className="rounded-sm bg-[var(--mark)] px-0.5 text-ink">{h.match}</mark>
                {h.after}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {count > LIST_LIMIT && (
        <p className="py-3 text-center text-[12px] text-ink-faint">Showing the first {LIST_LIMIT} results. Use the arrows to step through all {formatNumber(count)}.</p>
      )}
    </Drawer>
  )
}
