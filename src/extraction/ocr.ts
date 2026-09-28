/**
 * OCR extension point.
 *
 * OCR is NOT implemented in this version. Pages that contain no extractable
 * text (typically scanned images) are detected and reported as "empty" so the
 * reader can point the user to PDF view for those pages.
 *
 * To add OCR later, implement `OcrProvider` (e.g. with tesseract.js running in
 * its own worker), render the empty page to an OffscreenCanvas/ImageBitmap and
 * feed the recognised text through `layoutPage`-compatible blocks. Register the
 * provider with `setOcrProvider` and the extraction worker can call it for
 * pages whose status is "empty".
 */
export interface OcrProvider {
  readonly name: string
  recognise(image: ImageBitmap, language?: string): Promise<string>
}

let provider: OcrProvider | null = null

export function setOcrProvider(p: OcrProvider | null): void {
  provider = p
}

export function getOcrProvider(): OcrProvider | null {
  return provider
}

export const OCR_AVAILABLE = false
