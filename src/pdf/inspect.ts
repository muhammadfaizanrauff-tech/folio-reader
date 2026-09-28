import { openPdf } from './pdfjs'
import { friendlyError, MAX_FILE_BYTES, type FriendlyError } from './errors'
import { putBook, putFile, requestPersistentStorage } from '../storage/db'
import type { Book } from '../types'

export interface PdfInfo {
  file: File
  title: string
  author?: string
  pageCount: number
  hasOutline: boolean
  cover?: Blob
  password?: string
}

export type InspectResult = { ok: true; info: PdfInfo } | { ok: false; error: FriendlyError }

const JUNK_TITLE = /^(untitled|microsoft word|document\d*|none|null|title|\s*)$|\.(docx?|pdf|indd|tex)$|^microsoft word - /i

export function titleFromFilename(name: string): string {
  return (
    name
      .replace(/\.pdf$/i, '')
      .replace(/[_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Untitled book'
  )
}

async function looksLikePdf(file: File): Promise<boolean> {
  // A PDF header can be preceded by some junk bytes; PDF.js tolerates up to ~1KB.
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer())
  const text = String.fromCharCode(...head)
  return text.includes('%PDF-')
}

async function renderCover(page: import('pdfjs-dist').PDFPageProxy): Promise<Blob | undefined> {
  try {
    const base = page.getViewport({ scale: 1 })
    const scale = 360 / base.width
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    await page.render({ canvas, viewport, background: '#ffffff' }).promise
    return await new Promise<Blob | undefined>((resolve) => canvas.toBlob((b) => resolve(b ?? undefined), 'image/jpeg', 0.82))
  } catch {
    return undefined
  }
}

/**
 * Opens the PDF just long enough to read page count, metadata and render a
 * small cover thumbnail. The document is destroyed afterwards so its memory
 * is released before the extraction worker loads it.
 */
export async function inspectPdf(file: File, password?: string): Promise<InspectResult> {
  if (file.size === 0) return { ok: false, error: { kind: 'invalid', title: 'This file is empty', message: 'The selected file has no content.' } }
  if (file.size > MAX_FILE_BYTES)
    return {
      ok: false,
      error: {
        kind: 'too-large',
        title: 'This file is too large',
        message: 'Browsers can’t load PDFs larger than about 1.8 GB. Try splitting the PDF into smaller parts.',
      },
    }
  if (!(await looksLikePdf(file)))
    return {
      ok: false,
      error: { kind: 'not-pdf', title: 'This isn’t a PDF file', message: 'Please choose a file in PDF format (.pdf).' },
    }

  let pdf: import('pdfjs-dist').PDFDocumentProxy | undefined
  try {
    pdf = await openPdf(file, password)
    const [meta, outline, first] = await Promise.all([
      pdf.getMetadata().catch(() => null),
      pdf.getOutline().catch(() => null),
      pdf.getPage(1).catch(() => null),
    ])
    const info = (meta?.info ?? {}) as { Title?: string; Author?: string }
    const dcTitle = meta?.metadata?.get?.('dc:title') as string | undefined
    const rawTitle = [dcTitle, info.Title].find((t) => typeof t === 'string' && t.trim() && !JUNK_TITLE.test(t.trim()))
    const author = typeof info.Author === 'string' && info.Author.trim() ? info.Author.trim() : undefined
    const cover = first ? await renderCover(first) : undefined
    return {
      ok: true,
      info: {
        file,
        title: rawTitle?.trim() || titleFromFilename(file.name),
        author,
        pageCount: pdf.numPages,
        hasOutline: !!outline?.length,
        cover,
        password,
      },
    }
  } catch (err) {
    return { ok: false, error: friendlyError(err) }
  } finally {
    await pdf?.loadingTask.destroy().catch(() => undefined)
  }
}

/** Creates the library entry and stores the original PDF so it can be re-opened later without re-uploading. */
export async function importBook(info: PdfInfo): Promise<Book> {
  await requestPersistentStorage()
  const now = Date.now()
  const book: Book = {
    id: crypto.randomUUID(),
    filename: info.file.name,
    title: info.title,
    author: info.author,
    pageCount: info.pageCount,
    fileSize: info.file.size,
    fileLastModified: info.file.lastModified,
    createdAt: now,
    lastOpenedAt: now,
    extractionStatus: 'pending',
    processedPages: 0,
    extractionProgress: 0,
    totalCharacters: 0,
    pageChars: [],
    pageBlocks: [],
    emptyPages: [],
    failedPages: [],
    toc: [],
    tocSource: 'none',
    likelyScanned: false,
    cover: info.cover,
  }
  await putFile(book.id, info.file)
  await putBook(book)
  return book
}
