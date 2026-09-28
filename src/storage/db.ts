import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Book, PageRecord, ReadingProgress } from '../types'

/**
 * IndexedDB layout
 *
 *  books     – one small metadata record per book (key: id)
 *  pages     – one record per extracted page (key: [bookId, page]); read on demand
 *  files     – the original PDF blob (key: bookId); browsers keep large blobs on disk
 *  progress  – last reading position per book (key: bookId)
 *
 * This module is shared by the UI thread and the web workers.
 */
interface FolioDB extends DBSchema {
  books: { key: string; value: Book }
  pages: { key: [string, number]; value: PageRecord }
  files: { key: string; value: { bookId: string; blob: Blob } }
  progress: { key: string; value: ReadingProgress }
}

const DB_NAME = 'folio-reader'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase<FolioDB>> | null = null

export function getDB(): Promise<IDBPDatabase<FolioDB>> {
  if (!dbPromise) {
    dbPromise = openDB<FolioDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('pages')) db.createObjectStore('pages', { keyPath: ['bookId', 'page'] })
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'bookId' })
        if (!db.objectStoreNames.contains('progress')) db.createObjectStore('progress', { keyPath: 'bookId' })
      },
      blocking() {
        // Another tab wants to upgrade – close so it can proceed.
        dbPromise?.then((db) => db.close())
        dbPromise = null
      },
    })
  }
  return dbPromise
}

// ---------- books ----------

export async function listBooks(): Promise<Book[]> {
  const db = await getDB()
  const books = await db.getAll('books')
  return books.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
}

export async function getBook(id: string): Promise<Book | undefined> {
  return (await getDB()).get('books', id)
}

export async function putBook(book: Book): Promise<void> {
  await (await getDB()).put('books', book)
}

export async function updateBook(id: string, patch: Partial<Book>): Promise<Book | undefined> {
  const db = await getDB()
  const tx = db.transaction('books', 'readwrite')
  const book = await tx.store.get(id)
  if (!book) {
    await tx.done
    return undefined
  }
  const next = { ...book, ...patch }
  await tx.store.put(next)
  await tx.done
  return next
}

export async function deleteBook(id: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['books', 'pages', 'files', 'progress'], 'readwrite')
  await Promise.all([
    tx.objectStore('books').delete(id),
    tx.objectStore('pages').delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER])),
    tx.objectStore('files').delete(id),
    tx.objectStore('progress').delete(id),
  ])
  await tx.done
}

// ---------- files ----------

export async function putFile(bookId: string, blob: Blob): Promise<void> {
  await (await getDB()).put('files', { bookId, blob })
}

export async function getFile(bookId: string): Promise<Blob | undefined> {
  return (await (await getDB()).get('files', bookId))?.blob
}

// ---------- pages ----------

export function pageRange(bookId: string, from = 1, to = Number.MAX_SAFE_INTEGER): IDBKeyRange {
  return IDBKeyRange.bound([bookId, from], [bookId, to])
}

export async function getPages(bookId: string, from: number, to: number): Promise<PageRecord[]> {
  return (await getDB()).getAll('pages', pageRange(bookId, from, to))
}

export async function putPages(pages: PageRecord[]): Promise<void> {
  if (!pages.length) return
  const db = await getDB()
  const tx = db.transaction('pages', 'readwrite')
  for (const p of pages) tx.store.put(p)
  await tx.done
}

export async function clearPages(bookId: string): Promise<void> {
  await (await getDB()).delete('pages', pageRange(bookId))
}

// ---------- progress ----------

export async function getProgress(bookId: string): Promise<ReadingProgress | undefined> {
  return (await getDB()).get('progress', bookId)
}

export async function listProgress(): Promise<ReadingProgress[]> {
  return (await getDB()).getAll('progress')
}

export async function putProgress(p: ReadingProgress): Promise<void> {
  await (await getDB()).put('progress', p)
}

// ---------- storage quota ----------

export async function requestPersistentStorage(): Promise<void> {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist()
    }
  } catch {
    // Not supported – data is still stored, just "best effort".
  }
}

export async function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.()
    if (!e) return null
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 }
  } catch {
    return null
  }
}
