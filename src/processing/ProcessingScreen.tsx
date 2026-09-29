import { useEffect, useState, type ReactNode } from 'react'
import { extraction, useExtractionJob } from '../extraction/manager'
import { getBook } from '../storage/db'
import { navigate } from '../router'
import { Button, ProgressBar } from '../components/ui'
import { Icon } from '../components/Icon'
import { Cover } from '../library/BookCard'
import { formatDuration, formatNumber } from '../utils/format'
import type { Book } from '../types'

export function ProcessingScreen({ bookId }: { bookId: string }) {
  const job = useExtractionJob(bookId)
  const [book, setBook] = useState<Book | null | undefined>(undefined)
  const [password, setPassword] = useState('')

  useEffect(() => {
    getBook(bookId).then((b) => setBook(b ?? null))
  }, [bookId, job?.status])

  // Nothing running for this book (e.g. after a reload): offer to resume instead.
  const idle = !job && book

  // Finished → open the reader.
  useEffect(() => {
    if (job?.status !== 'complete') return
    const t = setTimeout(() => navigate({ name: 'reader', bookId }, true), 900)
    return () => clearTimeout(t)
  }, [job?.status, bookId])

  if (book === null) {
    return (
      <Centered>
        <p className="text-ink-soft">This book is no longer in your library.</p>
        <Button className="mt-6" onClick={() => navigate({ name: 'library' })}>
          Back to library
        </Button>
      </Centered>
    )
  }
  if (!book) return <Centered>{null}</Centered>

  const p = job?.progress
  const pageCount = p?.pageCount ?? book.pageCount
  const processed = p?.processed ?? book.processedPages
  const ocr = p?.phase === 'ocr' ? p.ocr : undefined
  const pct = ocr ? (ocr.total ? ocr.done / ocr.total : 0) : pageCount ? processed / pageCount : 0
  const remaining = p && p.pagesPerSecond > 0 ? (ocr ? ocr.total - ocr.done : pageCount - processed) / p.pagesPerSecond : NaN
  const running = job?.status === 'running' || job?.status === 'cancelling'

  let headline = 'Extracting your book…'
  let phaseText = ''
  if (job?.status === 'complete') headline = 'Your book is ready'
  else if (job?.status === 'cancelled' || idle) headline = 'Extraction paused'
  else if (job?.status === 'error') headline = job.error?.title ?? 'Extraction failed'
  if (running) {
    if (!p || p.phase === 'opening') phaseText = 'Opening PDF…'
    else if (p.phase === 'outline') phaseText = 'Reading table of contents…'
    else if (p.phase === 'finishing') phaseText = 'Cleaning up headers and building contents…'
    else if (ocr) {
      headline = 'Recognizing text in image pages…'
      phaseText = ocr.done === 0 && ocr.recognised === 0 ? 'Starting text recognition (OCR)…' : `Reading page ${formatNumber(ocr.page)} from its image · ${formatNumber(ocr.recognised)} recognized so far`
    } else phaseText = `Extracting page ${formatNumber(p.currentPage)} of ${formatNumber(pageCount)}…`
  }
  if (job?.status === 'cancelling') phaseText = ocr ? 'Stopping text recognition – your book stays readable…' : 'Stopping after the current page…'

  const passwordError = job?.status === 'error' && (job.error?.kind === 'password-required' || job.error?.kind === 'password-incorrect')

  return (
    <Centered>
      <Cover blob={book.cover} title={book.title} className="mx-auto h-[150px] w-[108px]" />
      <h1 className="mt-8 font-serif text-[28px] font-semibold text-ink" aria-live="polite">
        {headline}
      </h1>
      <p className="mt-2 truncate text-ink-soft" title={book.filename}>
        {book.filename}
      </p>

      <div className="mt-10 text-left">
        <div className="mb-2 flex items-baseline justify-between text-[14px]">
          <span className="text-ink tabular-nums">
            {ocr ? `Image page ${formatNumber(Math.min(ocr.done + 1, ocr.total))} / ${formatNumber(ocr.total)}` : `Page ${formatNumber(processed)} / ${formatNumber(pageCount)}`}
          </span>
          <span className="text-[22px] font-semibold tabular-nums text-ink">{Math.floor(pct * 100)}%</span>
        </div>
        <ProgressBar value={pct} striped={running} className="h-2" />
        <p className="mt-3 min-h-[1.5em] text-[14px] text-ink-soft" aria-live="polite">
          {phaseText}
          {running && (p?.phase === 'pages' || (ocr && ocr.done > 0)) && Number.isFinite(remaining) && (ocr ? ocr.done > 0 : processed > 3) && <span className="text-ink-faint"> · about {formatDuration(remaining)} left</span>}
        </p>

        {ocr && (
          <p className="mt-2 rounded-xl bg-accent-soft p-3 text-[13px] leading-relaxed text-ink-soft">
            Some pages have their text as pictures (common in presentations, designed documents and scans). Folio is reading them with on-device text recognition. This takes a second or two per page; you can start reading now and they’ll fill in.
          </p>
        )}
        <dl className="mt-6 grid grid-cols-3 gap-4 rounded-2xl border border-line p-4 text-center">
          <Stat label="Pages processed" value={formatNumber(processed)} />
          <Stat label="No text (scanned?)" value={formatNumber(p?.emptyPages ?? book.emptyPages.length)} />
          <Stat label="Failed pages" value={formatNumber(p?.failedPages ?? book.failedPages.length)} tone={(p?.failedPages ?? book.failedPages.length) ? 'warn' : undefined} />
        </dl>
        {p && p.pagesPerSecond > 0 && running && !ocr && (
          <p className="mt-3 text-center text-[12px] text-ink-faint">
            {p.pagesPerSecond.toFixed(p.pagesPerSecond < 10 ? 1 : 0)} pages/second · {formatNumber(p.totalCharacters)} characters so far
          </p>
        )}
      </div>

      {job?.status === 'error' && (
        <div className="mt-8 rounded-2xl bg-accent-soft p-4 text-left text-[14px] text-ink-soft" role="alert">
          <p>{job.error?.message}</p>
          {processed > 0 && <p className="mt-2">The {formatNumber(processed)} pages extracted so far have been kept.</p>}
          {passwordError && (
            <form
              className="mt-4 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                extraction.start(bookId, { password })
              }}
            >
              <input
                type="password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-label="PDF password"
                placeholder="PDF password"
                className="h-10 min-w-0 flex-1 rounded-full border border-line-strong bg-paper px-4 text-sm text-ink outline-none focus:border-accent"
              />
              <Button type="submit" variant="primary" disabled={!password}>
                Unlock
              </Button>
            </form>
          )}
          {job.error?.detail && (
            <details className="mt-3 text-[12px] text-ink-faint">
              <summary className="cursor-pointer select-none">Technical details</summary>
              <code className="mt-2 block break-all">{job.error.detail}</code>
            </details>
          )}
        </div>
      )}

      <div className="mt-10 flex flex-wrap justify-center gap-3">
        {running && (
          <>
            <Button variant="ghost" onClick={() => navigate({ name: 'library' })}>
              Continue in background
            </Button>
            <Button onClick={() => extraction.cancel(bookId)} disabled={job?.status === 'cancelling'} icon="stop">
              {ocr ? 'Skip recognition' : 'Cancel'}
            </Button>
            {ocr && (
              <Button variant="primary" icon="book-open" onClick={() => navigate({ name: 'reader', bookId })}>
                Start reading
              </Button>
            )}
          </>
        )}
        {job?.status === 'complete' && (
          <Button variant="primary" size="lg" icon="book-open" onClick={() => navigate({ name: 'reader', bookId }, true)}>
            Start reading
          </Button>
        )}
        {(job?.status === 'cancelled' || job?.status === 'error' || idle) && (
          <>
            <Button variant="ghost" onClick={() => navigate({ name: 'library' })}>
              Library
            </Button>
            {processed > 0 && (
              <Button icon="book-open" onClick={() => navigate({ name: 'reader', bookId })}>
                Read {formatNumber(processed)} extracted pages
              </Button>
            )}
            {!passwordError && processed < pageCount && (
              <Button variant="primary" icon="play" onClick={() => extraction.start(bookId)}>
                {processed > 0 ? 'Resume extraction' : 'Try again'}
              </Button>
            )}
          </>
        )}
      </div>
      {(job?.status === 'cancelled' || idle) && processed > 0 && (
        <p className="mt-4 text-[13px] text-ink-faint">Already extracted pages are saved. Resuming continues from page {formatNumber(processed + 1)}.</p>
      )}
    </Centered>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div>
      <dd className={tone ? 'text-[18px] font-semibold tabular-nums text-danger' : 'text-[18px] font-semibold tabular-nums text-ink'}>{value}</dd>
      <dt className="mt-0.5 text-[11px] text-ink-faint">{label}</dt>
    </div>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center px-6 py-16">
      <div className="fade-in w-full max-w-md text-center">
        {children}
        <p className="mt-12 flex items-center justify-center gap-1.5 text-[12px] text-ink-faint">
          <Icon name="lock" size={12} /> Processed locally in your browser
        </p>
      </div>
    </div>
  )
}
