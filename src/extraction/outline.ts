import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { TocEntry } from '../types'

interface OutlineNode {
  title: string
  dest: string | unknown[] | null
  items: OutlineNode[]
}

const MAX_ENTRIES = 2000
const MAX_DEPTH = 4

/** Resolves a PDF outline destination to a 1-based page number. */
async function destToPage(pdf: PDFDocumentProxy, dest: OutlineNode['dest']): Promise<number | null> {
  try {
    let explicit: unknown[] | null = null
    if (typeof dest === 'string') explicit = await pdf.getDestination(dest)
    else if (Array.isArray(dest)) explicit = dest
    if (!explicit || !explicit.length) return null
    const target = explicit[0]
    if (typeof target === 'number') return target + 1
    if (target && typeof target === 'object' && 'num' in target) {
      const index = await pdf.getPageIndex(target as { num: number; gen: number })
      return index + 1
    }
  } catch {
    // Broken destinations are common in real-world PDFs – just skip them.
  }
  return null
}

/** Reads the PDF's bookmarks (if any) into a flat list of entries. */
export async function readOutline(pdf: PDFDocumentProxy): Promise<TocEntry[]> {
  const outline = (await pdf.getOutline().catch(() => null)) as unknown as OutlineNode[] | null
  if (!outline?.length) return []

  const entries: TocEntry[] = []
  const walk = async (nodes: OutlineNode[], level: number) => {
    for (const node of nodes) {
      if (entries.length >= MAX_ENTRIES) return
      const page = await destToPage(pdf, node.dest)
      const title = (node.title ?? '').replace(/\s+/g, ' ').trim()
      if (page && title && page <= pdf.numPages) entries.push({ title, page, level })
      if (node.items?.length && level < MAX_DEPTH) await walk(node.items, level + 1)
    }
  }
  await walk(outline, 1)
  return entries
}
