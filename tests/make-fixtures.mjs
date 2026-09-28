// Generates test PDFs in tests/fixtures:
//   novel-1500.pdf     1,500 pages, 30 chapters, running headers, page numbers,
//                      indented paragraphs, hyphenation, search markers. No outline.
//   handbook-outline.pdf  60 pages with real PDF bookmarks (outline).
//   scanned-8.pdf      image-only pages (no text layer) – simulates a scan.
//   corrupt.pdf        PDF header followed by garbage.
//   not-a-pdf.pdf      plain text with a .pdf extension.
import { PDFDocument, PDFName, PDFNumber, PDFString, StandardFonts, rgb, PDFHexString } from 'pdf-lib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const out = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
mkdirSync(out, { recursive: true })

const WORDS = (
  'the sea was calm and the ship moved slowly through the grey morning light while the sailors ' +
  'spoke of distant harbours and old stories about storms that had come without warning across ' +
  'the water they remembered the captain who had never once lost his way even when the stars were ' +
  'hidden behind heavy clouds and the compass trembled beneath the lantern each evening the crew ' +
  'gathered near the mast to listen to the wind which seemed to carry voices from the islands far ' +
  'beyond the horizon where the maps ended and nobody could say what waited for travellers'
).split(' ')

let seed = 7
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const pick = () => WORDS[Math.floor(rand() * WORDS.length)]

function sentence() {
  const n = 8 + Math.floor(rand() * 14)
  const w = Array.from({ length: n }, pick)
  w[0] = w[0][0].toUpperCase() + w[0].slice(1)
  return w.join(' ') + (rand() < 0.15 ? '?' : '.')
}

function paragraph() {
  const n = 3 + Math.floor(rand() * 5)
  return Array.from({ length: n }, sentence).join(' ')
}

async function novel() {
  const pdf = await PDFDocument.create()
  pdf.setTitle('The Long Voyage')
  pdf.setAuthor('A. N. Example')
  const font = await pdf.embedFont(StandardFonts.TimesRoman)
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold)
  const W = 432
  const H = 648
  const margin = 54
  const size = 11
  const leading = 14.5
  const maxWidth = W - margin * 2
  const TOTAL = 1500
  const CHAPTERS = 30
  const perChapter = TOTAL / CHAPTERS

  let page = null
  let y = 0
  let pageNo = 0
  const markers = { 777: 'zephyrquartz', 1234: 'zephyrquartz', 1499: 'finalmarker' }

  const newPage = (chapterStart) => {
    page = pdf.addPage([W, H])
    pageNo++
    if (!chapterStart) {
      const header = pageNo % 2 ? 'THE LONG VOYAGE' : 'A. N. EXAMPLE'
      page.drawText(header, { x: (W - font.widthOfTextAtSize(header, 8)) / 2, y: H - 34, size: 8, font })
    }
    page.drawText(String(pageNo), { x: W / 2 - 6, y: 28, size: 9, font })
    y = H - margin - (chapterStart ? 110 : 10)
  }

  const writeParagraph = (text, isFirst) => {
    const words = text.split(' ')
    let line = ''
    let first = true
    const flush = (last) => {
      const indent = first && !isFirst ? 18 : 0
      if (y < margin + 20) {
        if (pageNo % perChapter === 0 || pageNo >= TOTAL) return false
        newPage(false)
      }
      page.drawText(line, { x: margin + indent, y, size, font })
      y -= leading
      first = false
      line = ''
      return !last || true
    }
    for (let i = 0; i < words.length; i++) {
      let w = words[i]
      const trial = line ? line + ' ' + w : w
      const indent = first && !isFirst ? 18 : 0
      if (font.widthOfTextAtSize(trial, size) > maxWidth - indent) {
        // Occasionally hyphenate a long word across the line break.
        if (w.length >= 8 && rand() < 0.5) {
          const cut = Math.floor(w.length / 2)
          const head = w.slice(0, cut) + '-'
          if (font.widthOfTextAtSize(line + ' ' + head, size) <= maxWidth - indent) {
            line = line + ' ' + head
            w = w.slice(cut)
          }
        }
        if (flush(false) === false) return
        line = w
      } else line = trial
    }
    if (line) flush(true)
    y -= 2
  }

  for (let c = 1; c <= CHAPTERS; c++) {
    newPage(true)
    const title = `Chapter ${c}`
    page.drawText(title, { x: (W - bold.widthOfTextAtSize(title, 24)) / 2, y: H - margin - 40, size: 24, font: bold })
    const sub = ['The Harbour', 'Open Water', 'The Storm', 'Islands', 'Night Watch', 'Landfall'][c % 6]
    page.drawText(sub, { x: (W - font.widthOfTextAtSize(sub, 15)) / 2, y: H - margin - 68, size: 15, font })
    let firstPara = true
    const endPage = c * perChapter
    while (pageNo < endPage) {
      let text = paragraph()
      const m = markers[pageNo]
      if (m) {
        text = `This page holds the ${m} marker for page ${pageNo}. ` + text
        delete markers[pageNo]
      }
      writeParagraph(text, firstPara)
      firstPara = false
      if (y < margin + 20 && pageNo < endPage) newPage(false)
    }
  }
  const bytes = await pdf.save({ useObjectStreams: true })
  writeFileSync(join(out, 'novel-1500.pdf'), bytes)
  console.log(`novel-1500.pdf  ${pdf.getPageCount()} pages, ${(bytes.length / 1e6).toFixed(1)} MB`)
}

async function handbook() {
  const pdf = await PDFDocument.create()
  pdf.setTitle('Field Handbook')
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const sections = ['Getting Started', 'Equipment', 'Navigation', 'Weather', 'Safety', 'Appendix']
  const pages = []
  for (let i = 0; i < 60; i++) {
    const p = pdf.addPage([595, 842])
    pages.push(p)
    let y = 780
    if (i % 10 === 0) {
      p.drawText(sections[i / 10], { x: 60, y, size: 22, font: bold })
      y -= 40
    }
    for (let k = 0; k < 6; k++) {
      const text = paragraph()
      const words = text.split(' ')
      let line = ''
      for (const w of words) {
        if (font.widthOfTextAtSize(line + ' ' + w, 11) > 475) {
          p.drawText(line.trim(), { x: 60, y, size: 11, font })
          y -= 15
          line = w
        } else line += ' ' + w
      }
      p.drawText(line.trim(), { x: 60, y, size: 11, font })
      y -= 26
      if (y < 100) break
    }
    p.drawText(String(i + 1), { x: 290, y: 40, size: 9, font, color: rgb(0.4, 0.4, 0.4) })
  }
  // Build a real /Outlines tree (pdf-lib has no high-level API for this).
  const ctx = pdf.context
  const outlinesRef = ctx.nextRef()
  const itemRefs = sections.map(() => ctx.nextRef())
  sections.forEach((title, i) => {
    const dict = ctx.obj({
      Title: PDFHexString.fromText(title),
      Parent: outlinesRef,
      Dest: ctx.obj([pages[i * 10].ref, PDFName.of('XYZ'), null, null, null]),
    })
    if (i > 0) dict.set(PDFName.of('Prev'), itemRefs[i - 1])
    if (i < sections.length - 1) dict.set(PDFName.of('Next'), itemRefs[i + 1])
    ctx.assign(itemRefs[i], dict)
  })
  ctx.assign(
    outlinesRef,
    ctx.obj({ Type: 'Outlines', First: itemRefs[0], Last: itemRefs[itemRefs.length - 1], Count: PDFNumber.of(sections.length) }),
  )
  pdf.catalog.set(PDFName.of('Outlines'), outlinesRef)
  pdf.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'))
  void PDFString
  writeFileSync(join(out, 'handbook-outline.pdf'), await pdf.save())
  console.log('handbook-outline.pdf  60 pages with bookmarks')
}

async function scanned() {
  const pdf = await PDFDocument.create()
  for (let i = 0; i < 8; i++) {
    const p = pdf.addPage([595, 842])
    // grey "scanned text" bars, no real text
    for (let l = 0; l < 40; l++) {
      p.drawRectangle({ x: 60, y: 780 - l * 17, width: 380 + ((l * 37) % 90), height: 8, color: rgb(0.25, 0.25, 0.25) })
    }
  }
  writeFileSync(join(out, 'scanned-8.pdf'), await pdf.save())
  console.log('scanned-8.pdf  8 image-only pages')
}

await novel()
await handbook()
await scanned()
writeFileSync(join(out, 'corrupt.pdf'), Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 131) % 256))]))
writeFileSync(join(out, 'not-a-pdf.pdf'), 'This is just a text file pretending to be a PDF.\n')
console.log('corrupt.pdf, not-a-pdf.pdf')
