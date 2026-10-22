/**
 * Pictures → PDF, entirely on this device.
 *
 * Photos of pages, screenshots and scans are turned into a one-page-per-picture
 * PDF before import, so they go through the same pipeline as any PDF: the
 * worker finds no text layer, and text recognition (OCR) reads each page from
 * its image. The PDF view shows the original pictures.
 *
 * Very tall pictures – full-page screenshots of a website on a phone – are cut
 * into page-sized pieces at full width, at blank rows between lines of text.
 * Shrinking one to fit a single page would make its text far too small to read.
 */

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif|tiff?)$/i

/** Longest side of a stored picture, in px. Plenty for OCR (~200 dpi on a letter page) without bloating storage. */
const MAX_SIDE = 3200
/** Widest a piece of a tall picture is kept, in px. */
const MAX_WIDTH = 2000
/** Pictures taller than this (height ÷ width) are cut into pieces. An ordinary phone screenshot is ~2.2. */
const TALL_RATIO = 2.6
/** Height ÷ width of each piece: roughly a book page. */
const PIECE_RATIO = 1.5
/** The cut is placed at the emptiest row in the last part of each piece. */
const CUT_WINDOW = 0.3
/** Longest side of a page, in PDF points (US letter height). */
const PAGE_SIDE = 792

export function isImageFile(f: File): boolean {
  return f.type.startsWith('image/') || IMAGE_EXT.test(f.name)
}

/** "IMG_1234.jpeg" → "IMG_1234" */
export function stripImageExtension(name: string): string {
  return name.replace(IMAGE_EXT, '')
}

/** File-name order, so IMG_2 comes before IMG_10. */
export function sortByName(files: File[]): File[] {
  return [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
}

export class ImageDecodeError extends Error {
  name = 'ImageDecodeError'
}

type Source = ImageBitmap | HTMLImageElement

interface Piece {
  bytes: Uint8Array
  png: boolean
  width: number
  height: number
}

/** Decodes a picture, applying its EXIF orientation (phone photos are often stored sideways). */
async function decode(file: File): Promise<Source> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    // Older Safari: fall back to an <img>, which also honours EXIF orientation.
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      return img
    } catch {
      throw new ImageDecodeError(`Could not decode ${file.name || 'picture'} (${file.type || 'unknown type'})`)
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

/** Draws rows [y, y + height) of the scaled picture onto a white canvas. */
function draw(img: Source, scale: number, width: number, y: number, height: number, readBack = false): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: readBack })
  if (!ctx) throw new Error('Canvas is not available')
  // White first: transparent PNGs would otherwise render black.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, 0, y / scale, img.width, height / scale, 0, 0, width, height)
  return canvas
}

/**
 * The row in [from, to) least likely to cut through text: the one with the
 * fewest light/dark changes along it (a blank gap between lines has none).
 * Ties go to the lowest row, so pieces stay close to full size.
 */
function quietestRow(img: Source, scale: number, width: number, from: number, to: number): number {
  const canvas = draw(img, scale, width, from, to - from, true)
  try {
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, width, to - from)
    const step = Math.max(1, Math.floor(width / 600))
    let best = to
    let bestScore = Infinity
    for (let r = to - from - 1; r >= 0; r--) {
      let score = 0
      let prev = -1
      for (let x = 0; x < width; x += step) {
        const i = (r * width + x) * 4
        const lum = (data[i] * 3 + data[i + 1] * 6 + data[i + 2]) / 10
        if (prev >= 0 && Math.abs(lum - prev) > 40) score++
        prev = lum
      }
      if (score < bestScore) {
        bestScore = score
        best = from + r
        if (score === 0) break
      }
    }
    return best
  } finally {
    canvas.width = canvas.height = 0
  }
}

/** Re-encodes the picture as one page, or as several when it is very tall. */
async function encode(file: File): Promise<Piece[]> {
  const img = await decode(file)
  try {
    const w0 = img.width
    const h0 = img.height
    if (!w0 || !h0) throw new ImageDecodeError(`${file.name || 'Picture'} has no pixels`)
    const tall = h0 / w0 > TALL_RATIO
    const scale = tall ? Math.min(1, MAX_WIDTH / w0) : Math.min(1, MAX_SIDE / Math.max(w0, h0))
    const width = Math.max(1, Math.round(w0 * scale))
    const total = Math.max(1, Math.round(h0 * scale))
    const pieceHeight = tall ? Math.round(width * PIECE_RATIO) : total
    // Screenshots (PNG) stay lossless so small text stays crisp; photos become JPEG.
    const png = file.type === 'image/png' || /\.png$/i.test(file.name)

    const pieces: Piece[] = []
    for (let y = 0; y < total; ) {
      let height = Math.min(pieceHeight, total - y)
      // Leave the rest for the next piece unless it would be a sliver.
      if (total - (y + height) > pieceHeight * 0.15) {
        const end = quietestRow(img, scale, width, y + Math.round(pieceHeight * (1 - CUT_WINDOW)), y + height)
        height = end - y
      } else height = total - y
      const canvas = draw(img, scale, width, y, height)
      try {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, png ? 'image/png' : 'image/jpeg', 0.9))
        if (!blob) throw new Error('The picture could not be re-encoded')
        pieces.push({ bytes: new Uint8Array(await blob.arrayBuffer()), png, width, height })
      } finally {
        canvas.width = canvas.height = 0
      }
      y += height
    }
    return pieces
  } finally {
    if ('close' in img) img.close()
  }
}

/**
 * Builds a PDF with one page per picture (several for a very tall one), in
 * file-name order (so IMG_0001 … IMG_0012 stay in sequence). The returned
 * File keeps the picture's name for display; the title is stored in the PDF
 * metadata.
 */
export async function imagesToPdf(files: File[], onProgress?: (done: number, total: number) => void): Promise<File> {
  const { PDFDocument } = await import('pdf-lib')
  const sorted = sortByName(files)
  const doc = await PDFDocument.create()
  const title = stripImageExtension(sorted[0].name).replace(/[_]+/g, ' ').trim() || 'Pictures'
  doc.setTitle(title)
  doc.setCreator('Folio')

  for (let i = 0; i < sorted.length; i++) {
    onProgress?.(i, sorted.length)
    for (const { bytes, png, width, height } of await encode(sorted[i])) {
      const image = png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
      const k = PAGE_SIDE / Math.max(width, height)
      const page = doc.addPage([width * k, height * k])
      page.drawImage(image, { x: 0, y: 0, width: width * k, height: height * k })
    }
  }
  onProgress?.(sorted.length, sorted.length)

  const out = await doc.save()
  const name = sorted.length === 1 ? sorted[0].name : `${sorted[0].name} + ${sorted.length - 1} more`
  return new File([out as BlobPart], name, { type: 'application/pdf', lastModified: Math.max(...sorted.map((f) => f.lastModified)) })
}
