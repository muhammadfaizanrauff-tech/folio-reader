import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { LibraryEntry } from './useLibrary'
import { useObjectUrl } from '../hooks/useObjectUrl'
import { Button, IconButton, ProgressBar } from '../components/ui'
import { cx } from '../utils/cx'
import { Icon } from '../components/Icon'
import { formatBytes, formatNumber, formatRelativeTime } from '../utils/format'
import type { JobState } from '../extraction/manager'

interface Props {
  entry: LibraryEntry
  job?: JobState
  onOpen: () => void
  onResumeExtraction: () => void
  onReextract: () => void
  onDelete: () => void
  onShowProcessing: () => void
}

export function Cover({ blob, title, className }: { blob?: Blob; title: string; className?: string }) {
  const url = useObjectUrl(blob)
  return (
    <div className={cx('relative overflow-hidden rounded-[6px] bg-paper-2 shadow-[0_1px_2px_rgb(0_0_0/0.08),0_8px_24px_-10px_rgb(0_0_0/0.35)]', className)}>
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover object-top" draggable={false} />
      ) : (
        <div className="flex h-full w-full items-center justify-center p-3 text-center font-serif text-sm leading-snug text-ink-soft">{title}</div>
      )}
      {/* book spine highlight */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-2 bg-gradient-to-r from-black/15 to-transparent" />
    </div>
  )
}

export function BookCard({ entry, job, onOpen, onResumeExtraction, onReextract, onDelete, onShowProcessing }: Props) {
  const { book, progress } = entry
  const [menu, setMenu] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        setMenu(false)
        setConfirmDelete(false)
      }
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [menu])

  const running = job?.status === 'running' || job?.status === 'cancelling'
  const liveProcessed = running && job?.progress ? job.progress.processed : book.processedPages
  const extractedPct = book.pageCount ? liveProcessed / book.pageCount : 0
  const readable = book.processedPages > 0 || running
  const pct = progress?.percentage ?? 0

  let status: { text: string; tone: 'info' | 'warn' | 'error' } | null = null
  if (running) status = { text: `Extracting · ${Math.floor(extractedPct * 100)}%`, tone: 'info' }
  else if (book.extractionStatus === 'error') status = { text: 'Extraction failed', tone: 'error' }
  else if (book.extractionStatus === 'cancelled' || book.extractionStatus === 'pending')
    status = { text: `Paused · ${formatNumber(book.processedPages)} of ${formatNumber(book.pageCount)} pages`, tone: 'warn' }
  else if (book.likelyScanned) status = { text: 'Scanned PDF · limited text', tone: 'warn' }

  return (
    <article className="group fade-in relative flex gap-4 rounded-2xl p-3 transition-colors hover:bg-hover/60" aria-label={book.title}>
      <button type="button" onClick={readable ? onOpen : onResumeExtraction} className="shrink-0 rounded-md" aria-label={`Open ${book.title}`}>
        <Cover blob={book.cover} title={book.title} className="h-[132px] w-[96px] transition-transform duration-300 group-hover:-translate-y-0.5" />
      </button>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 font-serif text-[17px] font-semibold leading-snug text-ink" title={book.title}>
              {book.title}
            </h3>
            {book.author && <p className="mt-0.5 truncate text-[13px] text-ink-soft">{book.author}</p>}
          </div>
          <div ref={menuRef} className="relative -mr-1 -mt-1">
            <IconButton icon="more" label="Book options" size="sm" tip={false} onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu" />
            {menu && (
              <div role="menu" className="absolute right-0 top-9 z-20 w-56 rounded-xl border border-line bg-panel p-1.5 shadow-float backdrop-blur-md">
                {!running && book.processedPages < book.pageCount && (
                  <MenuItem icon="play" onClick={() => (setMenu(false), onResumeExtraction())}>
                    Resume extraction
                  </MenuItem>
                )}
                {running && (
                  <MenuItem icon="gauge" onClick={() => (setMenu(false), onShowProcessing())}>
                    Show extraction progress
                  </MenuItem>
                )}
                {!running && (
                  <MenuItem icon="refresh" onClick={() => (setMenu(false), onReextract())}>
                    Extract again
                  </MenuItem>
                )}
                {!confirmDelete ? (
                  <MenuItem icon="trash" danger onClick={() => setConfirmDelete(true)}>
                    Remove from library…
                  </MenuItem>
                ) : (
                  <div className="p-2">
                    <p className="mb-2 text-[12px] text-ink-soft">This deletes the stored PDF, extracted text and reading position.</p>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                        Keep
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => (setMenu(false), onDelete())}>
                        Remove
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <p className="mt-2 text-[12px] text-ink-faint">
          {formatNumber(book.pageCount)} pages · {formatBytes(book.fileSize)}
          {progress && <> · Last read {formatRelativeTime(progress.updatedAt)}</>}
        </p>

        {status && (
          <p
            className={cx(
              'mt-1.5 inline-flex items-center gap-1.5 text-[12px] font-medium',
              status.tone === 'error' ? 'text-danger' : status.tone === 'warn' ? 'text-ink-soft' : 'text-accent',
            )}
          >
            {status.tone === 'info' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}
            {status.tone !== 'info' && <Icon name={status.tone === 'error' ? 'alert' : 'info'} size={13} />}
            {status.text}
          </p>
        )}

        <div className="mt-auto pt-3">
          {running ? (
            <ProgressBar value={extractedPct} striped />
          ) : (
            <div className="flex items-center gap-3">
              <ProgressBar value={pct / 100} className="flex-1" />
              <span className="w-9 text-right text-[12px] tabular-nums text-ink-faint">{Math.round(pct)}%</span>
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {readable && (
              <Button size="sm" variant={progress ? 'primary' : 'secondary'} icon="book-open" onClick={onOpen}>
                {progress ? 'Continue' : 'Read'}
              </Button>
            )}
            {!running && book.processedPages < book.pageCount && (
              <Button size="sm" variant={readable ? 'ghost' : 'primary'} icon="play" onClick={onResumeExtraction}>
                {book.processedPages ? 'Resume extraction' : 'Extract'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}

function MenuItem({ icon, children, onClick, danger }: { icon: Parameters<typeof Icon>[0]['name']; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cx('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-hover', danger ? 'text-danger' : 'text-ink')}
    >
      <Icon name={icon} size={15} />
      {children}
    </button>
  )
}
