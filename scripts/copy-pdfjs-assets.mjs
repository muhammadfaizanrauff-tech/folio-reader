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
