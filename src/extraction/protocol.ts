/** Messages exchanged between the UI thread and the extraction worker. */

export interface StartMessage {
  type: 'start'
  bookId: string
  file: Blob
  password?: string
  /** First page to process (1-based). Pages before it are assumed already stored (resume). */
  startPage: number
}

export interface CancelMessage {
  type: 'cancel'
}

export type ToWorker = StartMessage | CancelMessage

export interface ProgressMessage {
  type: 'progress'
  bookId: string
  pageCount: number
  /** Pages processed so far including those from previous runs. */
  processed: number
  currentPage: number
  emptyPages: number
  failedPages: number
  totalCharacters: number
  /** Pages processed per second in this run (measured, not estimated). */
  pagesPerSecond: number
  phase: 'opening' | 'outline' | 'pages' | 'finishing' | 'ocr'
  /** Text recognition of image-only pages (runs after extraction). */
  ocr?: { done: number; total: number; page: number; recognised: number }
}

export interface DoneMessage {
  type: 'done'
  bookId: string
  status: 'complete' | 'cancelled'
}

export interface ErrorMessage {
  type: 'error'
  bookId: string
  error: { name: string; message: string; code?: number }
}

export type FromWorker = ProgressMessage | DoneMessage | ErrorMessage
