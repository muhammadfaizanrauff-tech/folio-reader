/**
 * Pictures → PDF, entirely on this device.
 *
 * Photos of pages, screenshots and scans are turned into a one-page-per-picture
 * PDF before import, so they go through the same pipeline as any PDF: the
 * worker finds no text layer, and text recognition (OCR) reads each page from
 * its image. The PDF view shows the original pictures.
 */

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif|tiff?)$/i

/** Longest side of a stored picture, in px. Plenty for OCR (~200 dpi on a letter page) without bloating storage. */
const MAX_SIDE = 3200
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

/** Decodes a picture, applying its EXIF orientation (phone photos are often stored sideways). */
async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
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

/** Draws the picture on white (transparent PNGs would otherwise render black) and re-encodes it. */
async function encode(file: File): Promise<{ bytes: Uint8Array; png: boolean; width: number; height: number }> {
  const img = await decode(file)
  const w0 = img.width
  const h0 = img.height
  if (!w0 || !h0) throw new ImageDecodeError(`${file.name || 'Picture'} has no pixels`)
  const scale = Math.min(1, MAX_SIDE / Math.max(w0, h0))
  const width = Math.max(1, Math.round(w0 * scale))
  const height = Math.max(1, Math.round(h0 * scale))
  const canvas = document.createElement('canvas')
  try {
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is not available')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(img, 0, 0, width, height)
    // Screenshots (PNG) stay lossless so small text stays crisp; photos become JPEG.
    const png = file.type === 'image/png' || /\.png$/i.test(file.name)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, png ? 'image/png' : 'image/jpeg', 0.9))
    if (!blob) throw new Error('The picture could not be re-encoded')
    return { bytes: new Uint8Array(await blob.arrayBuffer()), png, width, height }
  } finally {
    if ('close' in img) img.close()
    canvas.width = canvas.height = 0
  }
}

/**
 * Builds a PDF with one page per picture, in file-name order (so IMG_0001 …
 * IMG_0012 stay in sequence). The returned File keeps the picture's name for
 * display; the title is stored in the PDF metadata.
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
    const { bytes, png, width, height } = await encode(sorted[i])
    const image = png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
    const k = PAGE_SIDE / Math.max(width, height)
    const page = doc.addPage([width * k, height * k])
    page.drawImage(image, { x: 0, y: 0, width: width * k, height: height * k })
  }
  onProgress?.(sorted.length, sorted.length)

  const out = await doc.save()
  const name = sorted.length === 1 ? sorted[0].name : `${sorted[0].name} + ${sorted.length - 1} more`
  return new File([out as BlobPart], name, { type: 'application/pdf', lastModified: Math.max(...sorted.map((f) => f.lastModified)) })
}
