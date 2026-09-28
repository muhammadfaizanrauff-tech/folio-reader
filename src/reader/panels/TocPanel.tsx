import { useEffect, useRef } from 'react'
import { Drawer } from './Drawer'
import { cx } from '../../utils/cx'
import type { TocEntry, Book } from '../../types'
import { formatNumber } from '../../utils/format'
import { currentTocIndex } from '../toc'
import { usePosition, type PositionStore } from '../position'

interface Props {
  open: boolean
  onClose: () => void
  book: Book
  toc: TocEntry[]
  positions: PositionStore
  onJump: (entry: TocEntry) => void
}

export function TocPanel({ open, onClose, book, toc, positions, onJump }: Props) {
  const { page: currentPage } = usePosition(positions)
  const current = currentTocIndex(toc, currentPage)
  const listRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    if (!open || current < 0) return
    // Scroll only the panel's own list (scrollIntoView could also move the book behind it).
    const item = listRef.current?.querySelector<HTMLElement>(`[data-toc="${current}"]`)
    const box = listRef.current?.closest<HTMLElement>('.overflow-y-auto')
    if (item && box) {
      const itemTop = item.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop
      box.scrollTop = itemTop - box.clientHeight / 2 + item.offsetHeight / 2
    }
  }, [open, current])

  return (
    <Drawer open={open} side="left" title="Contents" onClose={onClose} width={340}>
      {book.tocSource === 'detected' && toc.length > 0 && <p className="mb-3 text-[12px] leading-relaxed text-ink-faint">Generated from headings detected in the text.</p>}
      {toc.length === 0 ? (
        <div className="py-8 text-center text-[14px] leading-relaxed text-ink-soft">
          <p>This book has no table of contents.</p>
          <p className="mt-2 text-[13px] text-ink-faint">The PDF has no bookmarks and no clear chapter headings were found. Use “Go to page” or search instead.</p>
        </div>
      ) : (
        <ol ref={listRef} className="-mx-2 space-y-0.5">
          {toc.map((e, i) => (
            <li key={i}>
              <button
                type="button"
                data-toc={i}
                onClick={() => onJump(e)}
                aria-current={i === current ? 'location' : undefined}
                className={cx(
                  'flex w-full items-baseline gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-hover',
                  i === current ? 'bg-accent-soft text-ink' : e.level === 1 ? 'text-ink' : 'text-ink-soft',
                )}
                style={{ paddingLeft: 8 + (e.level - 1) * 16 }}
              >
                <span className={cx('min-w-0 flex-1 leading-snug', e.level === 1 ? 'text-[14px] font-medium' : 'text-[13px]')}>{e.title}</span>
                <span className="shrink-0 text-[12px] tabular-nums text-ink-faint">{formatNumber(e.page)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </Drawer>
  )
}
