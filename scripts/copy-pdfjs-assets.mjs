// Copies the PDF.js character maps and standard font data into /public so the
// extraction worker and the PDF viewer can load them at runtime (needed for
// CJK text and for PDFs that reference non-embedded standard fonts).
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', 'pdfjs-dist')
const dest = join(root, 'public', 'pdfjs')

for (const dir of ['cmaps', 'standard_fonts', 'wasm']) {
  const from = join(src, dir)
  if (!existsSync(from)) continue
  mkdirSync(join(dest, dir), { recursive: true })
  cpSync(from, join(dest, dir), { recursive: true })
}
console.log('Copied PDF.js assets to public/pdfjs')

// Tesseract (OCR for image-only pages): worker, WASM cores and English data,
// served locally so text recognition works offline.
const tDest = join(root, 'public', 'tesseract')
mkdirSync(tDest, { recursive: true })
const tjs = join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js')
if (existsSync(tjs)) cpSync(tjs, join(tDest, 'worker.min.js'))
const core = join(root, 'node_modules', 'tesseract.js-core')
for (const f of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js']) {
  if (existsSync(join(core, f))) cpSync(join(core, f), join(tDest, f))
}
const eng = join(root, 'node_modules', '@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz')
if (existsSync(eng)) cpSync(eng, join(tDest, 'eng.traineddata.gz'))
console.log('Copied Tesseract OCR assets to public/tesseract')
