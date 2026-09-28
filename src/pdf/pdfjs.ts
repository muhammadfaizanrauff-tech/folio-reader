import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const base = import.meta.env.BASE_URL

export const PDFJS_ASSET_OPTIONS = {
  cMapUrl: `${base}pdfjs/cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${base}pdfjs/standard_fonts/`,
  wasmUrl: `${base}pdfjs/wasm/`,
}

/**
 * Opens a PDF on the UI thread (parsing still happens in PDF.js' own worker).
 * Used for inspecting files before extraction and for the PDF view.
 */
export async function openPdf(data: Blob | ArrayBuffer, password?: string): Promise<PDFDocumentProxy> {
  const buffer = data instanceof Blob ? await data.arrayBuffer() : data
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    password,
    ...PDFJS_ASSET_OPTIONS,
    enableXfa: false,
  })
  return task.promise
}

export { pdfjs }
