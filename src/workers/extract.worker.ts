/// <reference lib="webworker" />
/**
 * Extraction worker.
 *
 * Runs PDF.js *inside this worker* (PDF.js' "fake worker" mode, enabled by
 * exposing its WorkerMessageHandler on globalThis), so parsing, text
 * extraction and layout analysis never touch the UI thread.
 *
 * Pages are processed one at a time; each page's blocks are written to
 * IndexedDB in small batches and then released, so memory use stays flat no
 * matter how many pages the book has. Only the PDF file bytes (needed by
 * PDF.js) and a few numbers per page are held in memory.
 */
// Legacy build: works on phones/older browsers (see src/pdf/pdfjs.ts).
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { getBook, getDB, pageRange, putPages, updateBook } from '../storage/db'
import { histogramMode, isLetterSpaced, isRemovableHeaderBlock, layoutPage, repairLetterSpacing, runningHeaderThreshold, type RawItem } from '../extraction/textLayout'
import { readOutline } from '../extraction/outline'
import { serialiseError } from '../pdf/errors'
import type { FromWorker, ProgressMessage, ToWorker } from '../extraction/protocol'
import type { Book, PageRecord, TocEntry } from '../types'

;(globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = pdfjsWorker

declare const self: DedicatedWorkerGlobalScope

const EMPTY_PAGE_CHARS = 16
const BATCH_SIZE = 16
const CLEANUP_EVERY = 64
const BOOK_SAVE_INTERVAL_MS = 1500
const PROGRESS_INTERVAL_MS = 80

let cancelRequested = false
let running = false

const post = (msg: FromWorker) => self.postMessage(msg)

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data
  if (msg.type === 'cancel') {
    cancelRequested = true
    return
  }
  if (msg.type === 'start') {
    if (running) return
    running = true
    cancelRequested = false
    extract(msg.bookId, msg.file, msg.startPage, msg.password)
      .catch((err) => post({ type: 'error', bookId: msg.bookId, error: serialiseError(err) }))
      .finally(() => {
        running = false
      })
  }
}

async function extract(bookId: string, file: Blob, startPage: number, password?: string) {
  const book = await getBook(bookId)
  if (!book) throw new Error('Book record not found')

  const progress: ProgressMessage = {
    type: 'progress',
    bookId,
    pageCount: book.pageCount,
    processed: Math.max(0, startPage - 1),
    currentPage: startPage,
    emptyPages: book.emptyPages.length,
    failedPages: book.failedPages.length,
    totalCharacters: book.totalCharacters,
    pagesPerSecond: 0,
    phase: 'opening',
  }
  post(progress)
  await updateBook(bookId, { extractionStatus: 'extracting', extractionError: undefined })

  const data = new Uint8Array(await file.arrayBuffer())
  const base = self.location.origin + (import.meta.env.BASE_URL ?? '/')
  const pdf: PDFDocumentProxy = await getDocument({
    data,
    password,
    cMapUrl: `${base}pdfjs/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}pdfjs/standard_fonts/`,
    wasmUrl: `${base}pdfjs/wasm/`,
    disableFontFace: true,
    // We're inside a worker (no `document`): fetch cmaps/fonts/wasm directly from absolute URLs.
    useWorkerFetch: true,
    enableXfa: false,
    useSystemFonts: false,
  }).promise

  try {
    const pageCount = pdf.numPages
    progress.pageCount = pageCount

    // Arrays sized to the page count: a few bytes per page, even for huge books.
    const pageChars = resize(book.pageChars, pageCount)
    const pageBlocks = resize(book.pageBlocks, pageCount)
    const empty = new Set(book.emptyPages)
    const failed = new Set(book.failedPages)

    // Bookmarks / outline (only on the first run).
    let toc = book.toc
    let tocSource = book.tocSource
    if (startPage <= 1) {
      progress.phase = 'outline'
      post(progress)
      const outline = await readOutline(pdf)
      toc = outline
      tocSource = outline.length ? 'outline' : 'none'
    }
    await updateBook(bookId, { pageCount, toc, tocSource })

    progress.phase = 'pages'
    const bodyHistogram = new Map<number, number>()
    let batch: PageRecord[] = []
    let lastProgressPost = 0
    let lastBookSave = performance.now()
    const runStart = performance.now()
    let runPages = 0

    const saveBook = async (patch: Partial<Book> = {}) => {
      const processed = progress.processed
      await updateBook(bookId, {
        processedPages: processed,
        extractionProgress: pageCount ? processed / pageCount : 0,
        pageChars,
        pageBlocks,
        emptyPages: [...empty].sort((a, b) => a - b),
        failedPages: [...failed].sort((a, b) => a - b),
        totalCharacters: pageChars.reduce((a, b) => a + b, 0),
        ...patch,
      })
    }

    for (let n = Math.max(1, startPage); n <= pageCount; n++) {
      if (cancelRequested) break
      progress.currentPage = n

      let record: PageRecord
      try {
        const page = await pdf.getPage(n)
        try {
          const content = await page.getTextContent()
          const [, , , pageHeight] = page.view
          const items = content.items as RawItem[]
          // Designed documents often letter-space headings; repair them from the glyph stream.
          if (items.some((it) => typeof it.str === 'string' && isLetterSpaced(it.str))) {
            try {
              repairLetterSpacing(items, await glyphText(page))
            } catch {
              // keep the text as extracted
            }
          }
          const result = layoutPage(items, pageHeight - page.view[1], histogramMode(bodyHistogram))
          for (const [size, count] of result.sizeHistogram) bodyHistogram.set(size, (bodyHistogram.get(size) ?? 0) + count)
          const isEmpty = result.chars < EMPTY_PAGE_CHARS
          record = {
            bookId,
            page: n,
            blocks: result.blocks,
            chars: result.chars,
            status: isEmpty ? 'empty' : 'ok',
            hfTop: result.hfTop,
            hfBottom: result.hfBottom,
          }
        } finally {
          page.cleanup()
        }
      } catch (err) {
        if (cancelRequested) break
        const e = serialiseError(err)
        record = { bookId, page: n, blocks: [], chars: 0, status: 'error', error: e.message }
      }

      pageChars[n - 1] = record.chars
      pageBlocks[n - 1] = record.blocks.length
      empty.delete(n)
      failed.delete(n)
      if (record.status === 'empty') empty.add(n)
      if (record.status === 'error') failed.add(n)
      batch.push(record)
      runPages++
      progress.processed = n
      progress.emptyPages = empty.size
      progress.failedPages = failed.size
      progress.totalCharacters += record.chars

      if (batch.length >= BATCH_SIZE) {
        await putPages(batch)
        batch = []
      }
      if (n % CLEANUP_EVERY === 0) {
        // Drop PDF.js caches (fonts, parsed resources) we no longer need.
        await pdf.cleanup().catch(() => undefined)
      }
      const now = performance.now()
      if (now - lastProgressPost > PROGRESS_INTERVAL_MS || n === pageCount) {
        progress.pagesPerSecond = runPages / Math.max(0.001, (now - runStart) / 1000)
        post(progress)
        lastProgressPost = now
      }
      if (now - lastBookSave > BOOK_SAVE_INTERVAL_MS) {
        await putPages(batch)
        batch = []
        await saveBook()
        lastBookSave = now
      }
    }
    await putPages(batch)

    progress.phase = 'finishing'
    post(progress)

    const finished = progress.processed >= pageCount && !cancelRequested
    const post_ = await finalise(bookId, progress.processed, pageChars, pageBlocks, tocSource === 'outline' ? toc : null)
    post_.newlyEmpty.forEach((n) => empty.add(n))
    const likelyScanned = progress.processed > 0 && empty.size / progress.processed > 0.6
    await saveBook({
      extractionStatus: finished ? (failed.size ? 'partial' : 'complete') : 'cancelled',
      totalCharacters: post_.totalCharacters,
      likelyScanned,
      toc: post_.toc ?? toc,
      tocSource: post_.toc ? (post_.toc.length ? 'detected' : 'none') : tocSource,
      extractionMs: (book.extractionMs ?? 0) + (performance.now() - runStart),
    })
    progress.totalCharacters = post_.totalCharacters
    post(progress)
    post({ type: 'done', bookId, status: finished ? 'complete' : 'cancelled' })
  } finally {
    await pdf.loadingTask.destroy().catch(() => undefined)
  }
}

/** The page's text exactly as drawn, glyph by glyph, including real space characters. */
async function glyphText(page: PDFPageProxy): Promise<string> {
  const ops = await page.getOperatorList()
  let out = ''
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]
    if (fn !== OPS.showText && fn !== OPS.showSpacedText) continue
    for (const g of ops.argsArray[i][0] as unknown[]) {
      if (g && typeof g === 'object' && 'unicode' in g) out += (g as { unicode: string }).unicode
      // A big negative kerning adjustment in a TJ array is a visual word gap.
      else if (typeof g === 'number' && g < -250) out += ' '
    }
  }
  return out
}

function resize(arr: number[] | undefined, len: number): number[] {
  const out = new Array<number>(len).fill(0)
  if (arr) for (let i = 0; i < Math.min(len, arr.length); i++) out[i] = arr[i]
  return out
}

/**
 * Second pass over the stored pages:
 *  1. removes running headers/footers that repeat on many pages
 *  2. builds a table of contents from detected headings (when the PDF has no outline)
 * Streams through IndexedDB with cursors so it never holds the whole book in memory.
 */
async function finalise(
  bookId: string,
  processed: number,
  pageChars: number[],
  pageBlocks: number[],
  existingToc: TocEntry[] | null,
): Promise<{ totalCharacters: number; toc: TocEntry[] | null; newlyEmpty: number[] }> {
  const db = await getDB()
  const range = pageRange(bookId)

  // Pass 1: count header/footer candidates.
  const counts = new Map<string, number>()
  {
    let cursor = await db.transaction('pages').store.openCursor(range)
    while (cursor) {
      const { hfTop, hfBottom } = cursor.value
      if (hfTop) counts.set('t:' + hfTop, (counts.get('t:' + hfTop) ?? 0) + 1)
      if (hfBottom) counts.set('b:' + hfBottom, (counts.get('b:' + hfBottom) ?? 0) + 1)
      cursor = await cursor.continue()
    }
  }
  const threshold = runningHeaderThreshold(processed)
  const isFrequent = (key: string) => (counts.get(key) ?? 0) >= threshold

  // Pass 2: strip running headers, collect headings.
  const buildToc = existingToc === null || existingToc.length === 0
  const detected: TocEntry[] = []
  const newlyEmpty: number[] = []
  const tx = db.transaction('pages', 'readwrite')
  let cursor = await tx.store.openCursor(range)
  while (cursor) {
    const rec = cursor.value
    let changed = false
    if (rec.hfTop && isFrequent('t:' + rec.hfTop) && isRemovableHeaderBlock(rec.blocks[0])) {
      rec.blocks = rec.blocks.slice(1)
      rec.hfTop = undefined
      changed = true
    }
    if (rec.hfBottom && isFrequent('b:' + rec.hfBottom) && rec.blocks.length) {
      rec.blocks = rec.blocks.slice(0, -1)
      rec.hfBottom = undefined
      changed = true
    }
    if (changed) {
      rec.chars = rec.blocks.reduce((n, b) => n + b.x.length, 0)
      if (rec.status === 'ok' && rec.chars < EMPTY_PAGE_CHARS) {
        rec.status = 'empty'
        newlyEmpty.push(rec.page)
      }
      pageChars[rec.page - 1] = rec.chars
      pageBlocks[rec.page - 1] = rec.blocks.length
      await cursor.update(rec)
    }
    if (buildToc && detected.length < 3000) {
      const levelOf = (t: string) => (t === 'h1' ? 1 : t === 'h2' ? 2 : 3)
      for (let i = 0; i < rec.blocks.length; i++) {
        const b = rec.blocks[i]
        if (b.t === 'p') continue
        const blockIndex = i
        let title = b.x
        // "Chapter 4" directly followed by a smaller subtitle → "Chapter 4: The Storm"
        const next = rec.blocks[i + 1]
        if (next && next.t !== 'p' && levelOf(next.t) > levelOf(b.t) && next.x.length <= 80 && b.x.length <= 40) {
          title = `${b.x}: ${next.x}`
          i++
        }
        detected.push({ title: title.slice(0, 140), page: rec.page, level: levelOf(b.t), block: blockIndex })
      }
    }
    cursor = await cursor.continue()
  }
  await tx.done

  let toc: TocEntry[] | null = null
  if (buildToc) {
    // If there are plenty of h1/h2 headings, h3s are usually noise (all-caps lines etc.).
    const major = detected.filter((e) => e.level <= 2)
    toc = major.length >= 3 ? major : detected
    // Normalise levels so the top level is 1.
    const minLevel = toc.reduce((m, e) => Math.min(m, e.level), 3)
    toc = toc.map((e) => ({ ...e, level: e.level - minLevel + 1 }))
  }
  return { totalCharacters: pageChars.reduce((a, b) => a + b, 0), toc, newlyEmpty }
}
