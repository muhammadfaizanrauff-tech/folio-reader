import { useSyncExternalStore } from 'react'
import { clearPages, getBook, getFile, updateBook } from '../storage/db'
import { friendlyError, type FriendlyError } from '../pdf/errors'
import type { FromWorker, ProgressMessage, StartMessage } from './protocol'
import { ocrBook } from './ocr'

/**
 * UI-side controller for the extraction worker.
 *
 * - One worker per extraction job; the worker is terminated when the job ends,
 *   which releases all memory PDF.js used for the document.
 * - State lives outside React so extraction keeps running while the user
 *   navigates between the library, the processing screen and the reader.
 */

export interface JobState {
  bookId: string
  status: 'running' | 'cancelling' | 'complete' | 'cancelled' | 'error'
  progress: ProgressMessage | null
  error?: FriendlyError
  startedAt: number
}

type Listener = () => void

class ExtractionManager {
  private jobs = new Map<string, JobState>()
  private workers = new Map<string, Worker>()
  private passwords = new Map<string, string>()
  private listeners = new Set<Listener>()
  private snapshot: ReadonlyMap<string, JobState> = new Map()
  private ocrCancel = new Set<string>()

  subscribe = (l: Listener) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  getSnapshot = () => this.snapshot

  private emit(bookId: string, patch: Partial<JobState>) {
    const prev = this.jobs.get(bookId)
    const next = { ...(prev ?? { bookId, status: 'running', progress: null, startedAt: Date.now() }), ...patch } as JobState
    this.jobs.set(bookId, next)
    this.snapshot = new Map(this.jobs)
    this.listeners.forEach((l) => l())
  }

  /** Passwords are only kept in memory for this session – never persisted. */
  getPassword(bookId: string): string | undefined {
    return this.passwords.get(bookId)
  }

  setPassword(bookId: string, password: string) {
    this.passwords.set(bookId, password)
  }

  isRunning(bookId: string): boolean {
    const s = this.jobs.get(bookId)?.status
    return s === 'running' || s === 'cancelling'
  }

  /** Starts (or resumes) extraction for a book whose PDF is already stored. */
  async start(bookId: string, opts: { password?: string; restart?: boolean } = {}): Promise<void> {
    if (this.isRunning(bookId)) return
    if (opts.password !== undefined) this.passwords.set(bookId, opts.password)

    this.emit(bookId, { status: 'running', progress: null, error: undefined, startedAt: Date.now() })

    try {
      const [book, file] = await Promise.all([getBook(bookId), getFile(bookId)])
      if (!book || !file) throw new Error('The stored PDF for this book could not be found. Please add the book again.')

      let startPage = book.processedPages + 1
      if (opts.restart || book.processedPages >= book.pageCount) {
        await clearPages(bookId)
        await updateBook(bookId, {
          processedPages: 0,
          extractionProgress: 0,
          totalCharacters: 0,
          pageChars: [],
          pageBlocks: [],
          emptyPages: [],
          failedPages: [],
          extractionMs: 0,
        })
        startPage = 1
      }

      const worker = new Worker(new URL('../workers/extract.worker.ts', import.meta.url), { type: 'module', name: 'folio-extract' })
      this.workers.set(bookId, worker)

      worker.onmessage = (ev: MessageEvent<FromWorker>) => this.onMessage(ev.data)
      worker.onerror = (ev) => {
        ev.preventDefault()
        this.fail(bookId, new Error(ev.message || 'The extraction worker crashed'))
      }
      const msg: StartMessage = { type: 'start', bookId, file, startPage, password: this.passwords.get(bookId) }
      worker.postMessage(msg)
    } catch (err) {
      this.fail(bookId, err)
    }
  }

  cancel(bookId: string) {
    if (this.jobs.get(bookId)?.progress?.phase === 'ocr') {
      this.ocrCancel.add(bookId)
      this.emit(bookId, { status: 'cancelling' })
      return
    }
    const worker = this.workers.get(bookId)
    if (!worker) return
    this.emit(bookId, { status: 'cancelling' })
    worker.postMessage({ type: 'cancel' })
    // If the worker is stuck inside a single huge page, force-stop after a grace period.
    setTimeout(() => {
      if (this.workers.get(bookId) === worker && this.jobs.get(bookId)?.status === 'cancelling') {
        this.stopWorker(bookId)
        updateBook(bookId, { extractionStatus: 'cancelled' }).finally(() => this.emit(bookId, { status: 'cancelled' }))
      }
    }, 6000)
  }

  private onMessage(msg: FromWorker) {
    switch (msg.type) {
      case 'progress':
        this.emit(msg.bookId, { progress: msg })
        break
      case 'done':
        this.stopWorker(msg.bookId)
        if (msg.status === 'complete') this.afterExtraction(msg.bookId)
        else this.emit(msg.bookId, { status: 'cancelled' })
        break
      case 'error': {
        const err = Object.assign(new Error(msg.error.message), { name: msg.error.name, code: msg.error.code })
        this.fail(msg.bookId, err)
        break
      }
    }
  }

  /** After text extraction: recognise image-only pages automatically, then finish. */
  private async afterExtraction(bookId: string) {
    const book = await getBook(bookId).catch(() => undefined)
    if (book && book.emptyPages.length > 0) await this.runOcr(bookId)
    else this.emit(bookId, { status: 'complete' })
  }

  /**
   * Text recognition (OCR) for pages without extractable text. Also callable
   * later from the reader ("Recognise text"). Cancelling keeps what's done.
   */
  async runOcr(bookId: string): Promise<void> {
    const cur = this.jobs.get(bookId)
    if (cur?.progress?.phase === 'ocr' && (cur.status === 'running' || cur.status === 'cancelling')) return
    const book = await getBook(bookId)
    if (!book) return
    this.ocrCancel.delete(bookId)
    const base: ProgressMessage = {
      type: 'progress',
      bookId,
      pageCount: book.pageCount,
      processed: book.processedPages,
      currentPage: book.processedPages,
      emptyPages: book.emptyPages.length,
      failedPages: book.failedPages.length,
      totalCharacters: book.totalCharacters,
      pagesPerSecond: 0,
      phase: 'ocr',
    }
    this.emit(bookId, { status: 'running', error: undefined, progress: { ...base, ocr: { done: 0, total: book.emptyPages.length, page: book.emptyPages[0] ?? 1, recognised: 0 } } })
    const started = performance.now()
    try {
      await ocrBook(bookId, {
        password: this.passwords.get(bookId),
        isCancelled: () => this.ocrCancel.has(bookId),
        onProgress: (p) => {
          const secs = (performance.now() - started) / 1000
          this.emit(bookId, { progress: { ...base, ocr: p, emptyPages: base.emptyPages - p.recognised, pagesPerSecond: p.done / Math.max(0.001, secs) } })
        },
      })
    } catch {
      // OCR is best-effort: the book stays readable, image pages remain viewable in PDF view.
    }
    this.ocrCancel.delete(bookId)
    this.emit(bookId, { status: 'complete' })
  }

  private fail(bookId: string, err: unknown) {
    this.stopWorker(bookId)
    const fe = friendlyError(err)
    if (fe.kind === 'password-incorrect' || fe.kind === 'password-required') this.passwords.delete(bookId)
    updateBook(bookId, { extractionStatus: 'error', extractionError: fe.message }).catch(() => undefined)
    this.emit(bookId, { status: 'error', error: fe })
  }

  private stopWorker(bookId: string) {
    const w = this.workers.get(bookId)
    if (w) {
      w.terminate()
      this.workers.delete(bookId)
    }
  }

  forget(bookId: string) {
    this.stopWorker(bookId)
    this.jobs.delete(bookId)
    this.passwords.delete(bookId)
    this.snapshot = new Map(this.jobs)
    this.listeners.forEach((l) => l())
  }
}

export const extraction = new ExtractionManager()

export function useExtractionJobs(): ReadonlyMap<string, JobState> {
  return useSyncExternalStore(extraction.subscribe, extraction.getSnapshot, extraction.getSnapshot)
}

export function useExtractionJob(bookId: string | null | undefined): JobState | undefined {
  const jobs = useExtractionJobs()
  return bookId ? jobs.get(bookId) : undefined
}
