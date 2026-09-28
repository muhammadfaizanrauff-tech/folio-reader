/**
 * Maps low-level PDF.js / browser errors to messages a normal reader understands.
 * The technical detail is kept separately so it can be shown in a "details" disclosure.
 */
export type PdfErrorKind =
  | 'password-required'
  | 'password-incorrect'
  | 'invalid'
  | 'too-large'
  | 'memory'
  | 'storage-full'
  | 'not-pdf'
  | 'cancelled'
  | 'unknown'

export interface FriendlyError {
  kind: PdfErrorKind
  title: string
  message: string
  detail?: string
}

export const MAX_FILE_BYTES = 1.8 * 1024 ** 3 // ~1.8 GB: above this browsers can't allocate the buffer
export const LARGE_FILE_BYTES = 300 * 1024 ** 2

export function friendlyError(err: unknown): FriendlyError {
  const e = err as { name?: string; message?: string; code?: number } | undefined
  const name = e?.name ?? ''
  const msg = e?.message ?? String(err)
  const detail = name ? `${name}: ${msg}` : msg

  if (name === 'PasswordException') {
    // PDF.js PasswordResponses: 1 = NEED_PASSWORD, 2 = INCORRECT_PASSWORD
    if (e?.code === 2)
      return { kind: 'password-incorrect', title: 'Incorrect password', message: 'That password didn’t unlock the PDF. Please try again.', detail }
    return {
      kind: 'password-required',
      title: 'This PDF is password-protected',
      message: 'Enter the document password to open it. The password is only used on this device.',
      detail,
    }
  }
  if (name === 'InvalidPDFException' || /invalid pdf|no pdf header|bad xref|corrupt/i.test(msg))
    return {
      kind: 'invalid',
      title: 'This file can’t be read as a PDF',
      message: 'The file appears to be damaged or isn’t a valid PDF. Try re-downloading it or exporting it again.',
      detail,
    }
  if (name === 'QuotaExceededError' || /quota/i.test(msg))
    return {
      kind: 'storage-full',
      title: 'Not enough storage space',
      message: 'Your browser ran out of space to save this book. Free up space by removing books from your library, then try again.',
      detail,
    }
  if (name === 'AbortError' || name === 'AbortException' || /cancel/i.test(msg))
    return { kind: 'cancelled', title: 'Cancelled', message: 'The operation was cancelled.', detail }
  if (name === 'RangeError' || /out of memory|allocation failed|array buffer allocation/i.test(msg))
    return {
      kind: 'memory',
      title: 'The browser ran out of memory',
      message: 'This PDF is too large to process in this browser tab. Close other tabs and try again, or try a desktop browser with more memory available.',
      detail,
    }
  return {
    kind: 'unknown',
    title: 'Something went wrong',
    message: 'The PDF couldn’t be processed. It may use features that aren’t supported. You can still try again.',
    detail,
  }
}

/** Serialisable error shape for postMessage between worker and UI. */
export function serialiseError(err: unknown): { name: string; message: string; code?: number } {
  const e = err as { name?: string; message?: string; code?: number }
  return { name: e?.name ?? 'Error', message: e?.message ?? String(err), code: e?.code }
}
