import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { Line, Paragraph, Worker as TesseractWorker } from 'tesseract.js'
import { openPdf } from '../pdf/pdfjs'
import { getBook, getDB, getFile, pageRange, putPages, updateBook } from '../storage/db'
import { classify, joinLine, normaliseHeaderKey } from './textLayout'
import type { Block, PageRecord, TocEntry } from '../types'

/**
 * Text recognition (OCR) for pages that contain no extractable text:
 * scanned books, and presentations or designed PDFs whose text was exported
 * as images or outlines.
 *
 * Runs Tesseract (WebAssembly) in its own worker, with the engine and English
 * language data served from this app (public/tesseract), so it works offline.
 * Each image page is rendered with PDF.js twice – once at high resolution for
 * body text and once small for very large text such as slide titles (which
 * OCR misses at high resolution) – and the two results are merged, grouped
 * into paragraphs by text size and spacing, and saved over the empty page.
 */

export interface OcrProgress {
  done: number
  total: number
  page: number
  recognised: number
}

const FINE_WIDTH = 2000 // px; ≈200 dpi for a letter-size page (body text)
const COARSE_WIDTH = 800 // px; catches very large text (titles)
const MAX_PIXELS = 12_000_000
const MIN_CONFIDENCE = 45

const base = import.meta.env.BASE_URL

async function createOcrWorker(): Promise<TesseractWorker> {
  const { createWorker, OEM } = await import('tesseract.js')
  return createWorker('eng', OEM.LSTM_ONLY, {
    workerPath: `${base}tesseract/worker.min.js`,
    corePath: `${base}tesseract/`,
    langPath: `${base}tesseract/`,
    gzip: true,
    workerBlobURL: false,
  })
}

function median(v: number[]): number {
  if (!v.length) return 0
  const s = [...v].sort((a, b) => a - b)
  return s[s.length >> 1]
}

export interface OcrLine {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
  h: number
}

/** Lines from a Tesseract result, in page units (divided by the render scale), in reading order. */
function collectLines(paragraphs: Paragraph[], scale: number): OcrLine[] {
  const out: OcrLine[] = []
  for (const p of paragraphs)
    for (const l of p.lines as Line[]) {
      const text = l.text.replace(/\s+/g, ' ').trim()
      if (l.confidence < MIN_CONFIDENCE || !/\p{L}{2}|\p{N}{2}/u.test(text)) continue
      const { x0, y0, x1, y1 } = l.bbox
      out.push({ text, x0: x0 / scale, y0: y0 / scale, x1: x1 / scale, y1: y1 / scale, h: (y1 - y0) / scale })
    }
  return out
}

const overlaps = (a: OcrLine, b: OcrLine) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

/** Adds coarse-pass lines (large text) that the detailed pass missed, in reading position. */
export function mergeLines(fine: OcrLine[], coarse: OcrLine[]): OcrLine[] {
  const merged = [...fine]
  for (const c of coarse) {
    if (fine.some((f) => overlaps(f, c))) continue
    const at = merged.findIndex((m) => m.y0 > c.y0 && m.x0 < c.x1 && c.x0 < m.x1)
    if (at < 0) merged.push(c)
    else merged.splice(at, 0, c)
  }
  return merged
}

/** OCR lines → Folio blocks: group by text size and spacing, then classify headings by relative size. */
export function linesToBlocks(lines: OcrLine[]): Block[] {
  const groups: { lines: OcrLine[]; h: number }[] = []
  for (const l of lines) {
    const g = groups[groups.length - 1]
    const last = g?.lines[g.lines.length - 1]
    const sameSize = !!g && Math.abs(l.h - g.h) / Math.max(l.h, g.h) < 0.22
    const close = !!last && l.y0 >= last.y0 && l.y0 - last.y1 < Math.max(l.h, last.h) * 0.9
    const aligned = !!last && l.x0 < last.x1 && last.x0 < l.x1
    if (g && sameSize && close && aligned) g.lines.push(l)
    else groups.push({ lines: [l], h: l.h })
  }
  const paras = groups.map((g) => ({
    text: g.lines.map((l) => l.text).reduce((acc, t) => joinLine(acc, t), ''),
    h: median(g.lines.map((l) => l.h)),
    lines: g.lines.length,
  }))
  // Body text height: the height covering most characters.
  const weighted: number[] = []
  for (const p of paras) for (let i = 0; i < Math.min(50, Math.ceil(p.text.length / 20)); i++) weighted.push(p.h)
  const body = median(weighted) || 1
  return paras.filter((p) => p.text.replace(/[^\p{L}\p{N}]/gu, '').length >= 2).map((p) => ({ t: classify(p.text, p.lines, p.h, body), x: p.text }))
}

async function recognisePage(worker: TesseractWorker, page: PDFPageProxy): Promise<Block[]> {
  const vp1 = page.getViewport({ scale: 1 })
  const pass = async (targetWidth: number) => {
    let scale = Math.min(3.5, Math.max(0.6, targetWidth / vp1.width))
    if (vp1.width * vp1.height * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (vp1.width * vp1.height))
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    try {
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      await page.render({ canvas, viewport, background: '#ffffff' }).promise
      const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false })
      return collectLines((data.blocks ?? []).flatMap((b) => b.paragraphs), scale)
    } finally {
      canvas.width = canvas.height = 0
    }
  }
  const fine = await pass(FINE_WIDTH)
  const coarse = await pass(COARSE_WIDTH)
  return linesToBlocks(mergeLines(fine, coarse))
}

/**
 * Recognises text on the book's empty pages. Returns how many pages gained text.
 * `isCancelled` is polled between pages.
 */
export async function ocrBook(
  bookId: string,
  opts: { password?: string; isCancelled: () => boolean; onProgress: (p: OcrProgress) => void },
): Promise<number> {
  const book = await getBook(bookId)
  const file = await getFile(bookId)
  if (!book || !file) return 0
  const targets = [...book.emptyPages].sort((a, b) => a - b)
  if (!targets.length) return 0

  let pdf: PDFDocumentProxy | null = null
  let worker: TesseractWorker | null = null
  const pageChars = [...book.pageChars]
  const pageBlocks = [...book.pageBlocks]
  const stillEmpty = new Set(book.emptyPages)
  const records: PageRecord[] = []
  const progress: OcrProgress = { done: 0, total: targets.length, page: targets[0], recognised: 0 }
  opts.onProgress({ ...progress })

  try {
    pdf = await openPdf(file, opts.password)
    worker = await createOcrWorker()
    for (const n of targets) {
      if (opts.isCancelled()) break
      progress.page = n
      opts.onProgress({ ...progress })
      const page = await pdf.getPage(n)
      try {
        const blocks = await recognisePage(worker, page)
        const chars = blocks.reduce((a, b) => a + b.x.length, 0)
        if (chars >= 16) {
          const rec: PageRecord = { bookId, page: n, blocks, chars, status: 'ok', ocr: true }
          records.push(rec)
          await putPages([rec])
          pageChars[n - 1] = chars
          pageBlocks[n - 1] = blocks.length
          stillEmpty.delete(n)
        }
      } catch {
        // A page that can't be rendered or recognised simply stays an image page.
      } finally {
        page.cleanup()
      }
      progress.done++
      progress.recognised = records.length
      opts.onProgress({ ...progress })
    }
  } finally {
    await worker?.terminate().catch(() => undefined)
    await pdf?.loadingTask.destroy().catch(() => undefined)
  }

  // A label repeated at the top of most recognised pages (slide header, running head) is noise.
  if (records.length >= 3) {
    const keyOf = (r: PageRecord) => (r.blocks[0] && r.blocks[0].t !== 'h1' ? normaliseHeaderKey(r.blocks[0].x) : '')
    const counts = new Map<string, number>()
    for (const r of records) {
      const k = keyOf(r)
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    const changed: PageRecord[] = []
    for (const r of records) {
      const k = keyOf(r)
      if (k && (counts.get(k) ?? 0) >= Math.max(3, records.length * 0.5) && r.blocks.length > 1) {
        r.blocks = r.blocks.slice(1)
        r.chars = r.blocks.reduce((a, b) => a + b.x.length, 0)
        pageChars[r.page - 1] = r.chars
        pageBlocks[r.page - 1] = r.blocks.length
        changed.push(r)
      }
    }
    if (changed.length) await putPages(changed)
  }

  if (!opts.isCancelled()) await updateBook(bookId, { ocrAttempted: true })
  if (records.length > 0) {
    const fresh = await getBook(bookId)
    const processed = fresh?.processedPages ?? book.processedPages
    const toc = fresh && fresh.tocSource !== 'outline' ? await detectedToc(bookId) : null
    await updateBook(bookId, {
      pageChars,
      pageBlocks,
      emptyPages: [...stillEmpty].sort((a, b) => a - b),
      totalCharacters: pageChars.reduce((a, b) => a + b, 0),
      likelyScanned: processed > 0 && stillEmpty.size / processed > 0.6,
      ocrPages: (fresh?.ocrPages ?? 0) + records.length,
      ...(toc ? { toc, tocSource: toc.length ? ('detected' as const) : ('none' as const) } : {}),
    })
  }
  return records.length
}

/** Rebuilds the heading-based table of contents after OCR added text. */
async function detectedToc(bookId: string): Promise<TocEntry[]> {
  const db = await getDB()
  const out: TocEntry[] = []
  let cursor = await db.transaction('pages').store.openCursor(pageRange(bookId))
  while (cursor && out.length < 3000) {
    const rec = cursor.value
    rec.blocks.forEach((b, i) => {
      if (b.t !== 'p') out.push({ title: b.x.slice(0, 140), page: rec.page, level: b.t === 'h1' ? 1 : b.t === 'h2' ? 2 : 3, block: i })
    })
    cursor = await cursor.continue()
  }
  const major = out.filter((e) => e.level <= 2)
  const toc = major.length >= 3 ? major : out
  const min = toc.reduce((m, e) => Math.min(m, e.level), 3)
  return toc.map((e) => ({ ...e, level: e.level - min + 1 }))
}
