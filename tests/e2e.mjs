// End-to-end tests driven through a real Chrome (playwright-core + system Chrome).
//
//   npm run fixtures            # generate test PDFs once
//   npm run dev -- --port 5199  # in another terminal
//   npm run test:e2e            # (BASE_URL=http://localhost:5199 by default)
//
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const FIX = join(here, 'fixtures')
const SHOTS = join(here, 'screenshots')
mkdirSync(SHOTS, { recursive: true })
const BASE = process.env.BASE_URL ?? 'http://localhost:5199'
const HEADLESS = process.env.HEADED ? false : true

const results = []
const consoleErrors = []
let page

async function step(name, fn) {
  const t = Date.now()
  try {
    await fn()
    results.push({ name, ok: true, ms: Date.now() - t })
    console.log(`  ✓ ${name} (${Date.now() - t} ms)`)
  } catch (err) {
    results.push({ name, ok: false, err: String(err?.message ?? err) })
    console.log(`  ✗ ${name}\n      ${String(err?.message ?? err).split('\n')[0]}`)
    await page?.screenshot({ path: join(SHOTS, `FAIL-${name.replace(/\W+/g, '-')}.png`) }).catch(() => {})
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const shot = (name) => page.screenshot({ path: join(SHOTS, `${name}.png`) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function uploadFile(file) {
  await page.goto(`${BASE}/#/`)
  await page.waitForSelector('text=Folio')
  await page.setInputFiles('input[type=file]', join(FIX, file))
}

async function readerState() {
  return page.evaluate(() => {
    const s = document.querySelector('.reader-scroll')
    const sections = document.querySelectorAll('.reader-scroll section[data-page]')
    return {
      scrollTop: s?.scrollTop ?? -1,
      scrollHeight: s?.scrollHeight ?? -1,
      renderedPages: sections.length,
      firstRendered: Number(sections[0]?.getAttribute('data-page')),
      lastRendered: Number(sections[sections.length - 1]?.getAttribute('data-page')),
      domNodes: document.getElementsByTagName('*').length,
      pageInput: document.querySelector('#goto-page')?.value,
    }
  })
}

const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS, args: ['--autoplay-policy=no-user-gesture-required'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
page = await context.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message))

console.log(`\nFolio e2e — ${BASE}\n`)

// ------------------------------------------------------------------ library
await step('library: empty state renders', async () => {
  await page.goto(`${BASE}/#/`)
  await page.waitForSelector('text=Add your first book')
  await shot('01-library-empty')
})

// ------------------------------------------------------------------ errors
await step('upload: non-PDF file is rejected with a friendly message', async () => {
  await uploadFile('not-a-pdf.pdf')
  await page.waitForSelector('text=This isn’t a PDF file', { timeout: 10000 })
})

await step('upload: corrupted PDF shows an understandable error', async () => {
  await uploadFile('corrupt.pdf')
  await page.waitForSelector('text=This file can’t be read as a PDF', { timeout: 15000 })
  const body = await page.textContent('body')
  assert(!/at \w+ \(|stack/i.test(body.split('Technical details')[0]), 'stack trace visible as primary error')
  await shot('02-error-corrupt')
})

if (existsSync(join(FIX, 'locked.pdf'))) {
  await step('upload: password-protected PDF asks for a password and unlocks', async () => {
    await uploadFile('locked.pdf')
    await page.waitForSelector('text=This PDF is password-protected', { timeout: 15000 })
    await page.fill('input[type=password]', 'wrong')
    await page.click('button:has-text("Unlock")')
    await page.waitForSelector('text=Incorrect password', { timeout: 15000 })
    await page.fill('input[type=password]', 'secret')
    await page.click('button:has-text("Unlock")')
    await page.waitForSelector('button:has-text("Extract & Read")', { timeout: 15000 })
    await page.click('button:has-text("Extract & Read")')
    await page.waitForURL(/#\/read\//, { timeout: 60000 })
    await page.waitForSelector('.reader-text p')
  })
}

// ------------------------------------------------------------------ large book
await step('upload: 1,500-page PDF shows book info before extraction', async () => {
  await uploadFile('novel-1500.pdf')
  await page.waitForSelector('button:has-text("Extract & Read")', { timeout: 30000 })
  const text = await page.textContent('main')
  assert(text.includes('1,500'), 'page count not shown')
  assert(text.includes('The Long Voyage'), 'title from metadata not shown')
  assert(text.includes('A. N. Example'), 'author not shown')
  assert(/2\.\d MB|3\.\d MB/.test(text), 'file size not shown')
  await shot('03-upload-info')
})

let extractionMs = 0
await step('extraction: progressive, real progress, UI stays responsive', async () => {
  const t0 = Date.now()
  await page.click('button:has-text("Extract & Read")')
  await page.waitForURL(/#\/processing\//)
  await page.waitForSelector('text=/Extracting page [\\d,]+ of 1,500/', { timeout: 30000 })
  // Measure main-thread frame rate while the worker extracts.
  const fps = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 0
        const start = performance.now()
        const tick = () => {
          frames++
          if (performance.now() - start < 1000) requestAnimationFrame(tick)
          else resolve(frames)
        }
        requestAnimationFrame(tick)
      }),
  )
  const label = await page.textContent('h1 + p + div')
  await shot('04-processing')
  console.log(`      main thread during extraction: ${fps} fps; ${label.match(/Page [\d,]+ \/ [\d,]+/)?.[0]}`)
  assert(fps >= 40, `UI janky during extraction (${fps} fps)`)
  await page.waitForURL(/#\/read\//, { timeout: 180000 })
  extractionMs = Date.now() - t0
  console.log(`      1,500 pages extracted in ${(extractionMs / 1000).toFixed(1)} s`)
})

await step('reader: formatted text with title, chapter headings and paragraphs', async () => {
  await page.waitForSelector('.reader-text h1:has-text("Chapter 1")', { timeout: 15000 })
  const info = await page.evaluate(() => ({
    title: document.querySelector('.reader-text header h1')?.textContent,
    paras: document.querySelectorAll('.reader-text p').length,
    headersLeft: [...document.querySelectorAll('.reader-text p')].filter((p) => /^(THE LONG VOYAGE|A\. N\. EXAMPLE)$/.test(p.textContent.trim())).length,
    bareNumbers: [...document.querySelectorAll('.reader-text p')].filter((p) => /^\d+$/.test(p.textContent.trim())).length,
  }))
  assert(info.title === 'The Long Voyage', 'book title missing')
  assert(info.paras > 5, 'no paragraphs')
  assert(info.headersLeft === 0, `running headers not removed (${info.headersLeft})`)
  assert(info.bareNumbers === 0, 'page numbers leaked into text')
  await shot('05-reader')
})

await step('reader: virtualised — only a handful of pages in the DOM', async () => {
  const s = await readerState()
  console.log(`      rendered pages: ${s.renderedPages}, DOM nodes: ${s.domNodes}, scrollHeight: ${Math.round(s.scrollHeight)} px`)
  assert(s.renderedPages > 0 && s.renderedPages < 20, `rendered ${s.renderedPages} pages`)
  assert(s.domNodes < 3000, `too many DOM nodes: ${s.domNodes}`)
})

await step('auto-scroll: Space starts smooth continuous scrolling', async () => {
  await page.mouse.move(700, 450)
  const before = (await readerState()).scrollTop
  await page.keyboard.press('Space')
  await sleep(300)
  // Sample the visual position every frame for 1.5 s: scrollTop + sub-pixel transform.
  const samples = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const el = document.querySelector('.reader-scroll')
        const content = el.firstElementChild
        const out = []
        const start = performance.now()
        const tick = () => {
          const m = /translate3d\(0px, (-?[\d.]+)px/.exec(content.style.transform)
          out.push({ t: performance.now(), y: el.scrollTop - (m ? parseFloat(m[1]) : 0) })
          if (performance.now() - start < 1500) requestAnimationFrame(tick)
          else resolve(out)
        }
        requestAnimationFrame(tick)
      }),
  )
  const after = (await readerState()).scrollTop
  const deltas = samples.slice(1).map((s, i) => s.y - samples[i].y)
  const maxJump = Math.max(...deltas)
  const backwards = deltas.filter((d) => d < -0.01).length
  const speed = (samples.at(-1).y - samples[0].y) / ((samples.at(-1).t - samples[0].t) / 1000)
  console.log(`      moved ${Math.round(after - before)} px; measured ${speed.toFixed(1)} px/s; max per-frame step ${maxJump.toFixed(2)} px; backwards steps ${backwards}`)
  assert(after - before > 20, 'did not scroll')
  assert(maxJump < 4, `visible jump of ${maxJump}px`)
  assert(backwards === 0, 'position moved backwards')
  assert(speed > 25 && speed < 50, `speed ${speed} not near 36 px/s`)
})

await step('auto-scroll: speed changes live with → and is persisted', async () => {
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await sleep(250)
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('folio.settings.v1') ?? '{}').autoScrollSpeed)
  assert(saved > 36, `speed not saved (${saved})`)
  const a = (await readerState()).scrollTop
  await sleep(1000)
  const b = (await readerState()).scrollTop
  console.log(`      new speed ${saved} px/s, observed ~${b - a} px/s`)
  assert(b - a > 36, 'speed did not increase while scrolling')
})

await step('auto-scroll: manual wheel scroll pauses it; Space resumes', async () => {
  await page.mouse.wheel(0, 300)
  await sleep(400)
  await page.waitForSelector('text=Auto-scroll paused', { timeout: 4000 }).catch(async () => {
    // pill is only shown when controls are hidden; check state through the toolbar instead
    await page.waitForSelector('[aria-label^="Resume auto-scroll"]', { timeout: 2000 })
  })
  const a = (await readerState()).scrollTop
  await sleep(600)
  const b = (await readerState()).scrollTop
  assert(Math.abs(b - a) < 2, 'still scrolling after manual input')
  await page.keyboard.press('Space')
  await sleep(900)
  const c = (await readerState()).scrollTop
  assert(c - b > 10, 'did not resume')
  await page.keyboard.press('Space') // pause
  await page.evaluate(() => localStorage.setItem('folio.settings.v1', JSON.stringify({ ...JSON.parse(localStorage.getItem('folio.settings.v1')), autoScrollSpeed: 36 })))
})

await step('go to page: jump to page 777 via the page box', async () => {
  await page.mouse.move(700, 100)
  await sleep(400)
  await page.click('#goto-page')
  await page.fill('#goto-page', '777')
  await page.keyboard.press('Enter')
  await sleep(700)
  const s = await readerState()
  assert(s.firstRendered <= 777 && s.lastRendered >= 777, `page 777 not rendered (${s.firstRendered}-${s.lastRendered})`)
  const shown = await page.$eval('#goto-page', (e) => e.value)
  assert(Math.abs(Number(shown) - 777) <= 1, `page indicator shows ${shown}`)
  const pct = await page.textContent('text=/% complete/')
  console.log(`      indicator: page ${shown}, ${pct.trim()}`)
})

await step('font size: + changes size instantly and keeps the reading position', async () => {
  const before = await page.$eval('#goto-page', (e) => Number(e.value))
  const size0 = await page.$eval('.reader-text', (e) => e.style.getPropertyValue('--reader-size'))
  await page.keyboard.press('+')
  await page.keyboard.press('+')
  await page.keyboard.press('+')
  await sleep(500)
  const size1 = await page.$eval('.reader-text', (e) => e.style.getPropertyValue('--reader-size'))
  const after = await page.$eval('#goto-page', (e) => Number(e.value))
  console.log(`      ${size0} → ${size1}; page ${before} → ${after}`)
  assert(size0 !== size1, 'font size unchanged')
  assert(Math.abs(after - before) <= 1, 'reading position jumped')
  await page.keyboard.press('-')
  await page.keyboard.press('-')
  await page.keyboard.press('-')
})

await step('themes: D cycles light → sepia → dark → comfort', async () => {
  const seen = []
  for (let i = 0; i < 4; i++) {
    seen.push(await page.evaluate(() => document.documentElement.dataset.theme))
    if (i === 2) await shot('06-reader-dark')
    await page.keyboard.press('d')
    await sleep(150)
  }
  assert(new Set(seen).size === 4, `themes seen: ${seen}`)
  await shot('07-reader-light-again')
})

await step('settings panel: font family, line height, width, ambient light', async () => {
  await page.keyboard.press('s')
  await page.waitForSelector('aside[aria-label="Reading settings"]:not([aria-hidden="true"])')
  await page.click('aside[aria-label="Reading settings"] button[role=radio]:has-text("Merriweather")')
  const font = await page.$eval('.reader-text', (e) => e.style.getPropertyValue('--reader-font'))
  assert(font.includes('Merriweather'), 'font family not applied')
  await page.click('aside[aria-label="Reading settings"] button[role=switch][aria-label="Ambient light"]')
  await sleep(200)
  const overlay = await page.$('div[aria-hidden="true"].fixed.inset-0[style*="multiply"]')
  assert(overlay, 'ambient overlay missing')
  await shot('08-settings-panel')
  await page.click('aside[aria-label="Reading settings"] button[role=switch][aria-label="Ambient light"]')
  await page.click('aside[aria-label="Reading settings"] button[role=radio]:has-text("Literata")')
  await page.keyboard.press('Escape')
})

await step('search: finds matches across the whole book and jumps to them', async () => {
  await page.keyboard.press('/')
  await page.waitForSelector('aside[aria-label="Search"]:not([aria-hidden="true"]) input[type=search]')
  await page.fill('aside[aria-label="Search"] input[type=search]', 'zephyrquartz')
  await page.waitForSelector('text=/2 matches/', { timeout: 15000 })
  await sleep(1200)
  let pg = await page.$eval('#goto-page', (e) => Number(e.value))
  assert(Math.abs(pg - 777) <= 1, `first hit not shown (page ${pg})`)
  await page.keyboard.press('Enter') // next match (input focused)
  await sleep(1500)
  pg = await page.$eval('#goto-page', (e) => Number(e.value))
  const visible = await page.evaluate(() => {
    const m = document.querySelector('mark[data-active]')
    if (!m) return false
    const r = m.getBoundingClientRect()
    return r.top > 0 && r.bottom < innerHeight
  })
  console.log(`      second hit on page ${pg}; highlighted & visible: ${visible}`)
  assert(Math.abs(pg - 1234) <= 1, `second hit not shown (page ${pg})`)
  assert(visible, 'active match not visible')
  await shot('09-search')
  // common word: many matches, stays responsive
  await page.fill('aside[aria-label="Search"] input[type=search]', 'lantern')
  const t0 = Date.now()
  await page.waitForFunction(() => /[\d,]{3,}\+? matches/.test(document.querySelector('aside[aria-label="Search"] p[aria-live]')?.textContent ?? ''), null, { timeout: 30000 })
  const status = await page.textContent('aside[aria-label="Search"] p[aria-live]')
  console.log(`      "lantern": ${status.trim()} in ${Date.now() - t0} ms (incl. 250 ms debounce)`)
  await page.fill('aside[aria-label="Search"] input[type=search]', '')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
})

await step('table of contents: generated from headings, click jumps to chapter', async () => {
  await page.keyboard.press('t')
  await page.waitForSelector('aside[aria-label="Contents"]:not([aria-hidden="true"])')
  const entries = await page.$$eval('aside[aria-label="Contents"] li button', (b) => b.map((x) => x.textContent))
  console.log(`      ${entries.length} entries, e.g. "${entries[3]}"`)
  assert(entries.length === 30, `expected 30 chapters, got ${entries.length}`)
  await page.click('aside[aria-label="Contents"] li button:has-text("Chapter 12:")')
  await sleep(1200)
  const pg = await page.$eval('#goto-page', (e) => Number(e.value))
  assert(Math.abs(pg - 551) <= 1, `chapter 12 should start on page 551, at ${pg}`)
  const chapter = await page.textContent('header p.text-\\[12px\\]')
  assert(chapter.includes('Chapter 12'), `current chapter label is "${chapter}"`)
  await shot('10-toc')
  await page.keyboard.press('Escape')
})

let savedPage = 0
await step('persistence: reload restores book, position and settings', async () => {
  await page.keyboard.press('+')
  await sleep(1500) // progress save is debounced
  savedPage = await page.$eval('#goto-page', (e) => Number(e.value))
  await page.reload()
  await page.waitForSelector('.reader-text p', { timeout: 15000 })
  await sleep(1000)
  const pg = await page.$eval('#goto-page', (e) => Number(e.value))
  const size = await page.$eval('.reader-text', (e) => e.style.getPropertyValue('--reader-size'))
  console.log(`      saved page ${savedPage} → restored ${pg}; font ${size}`)
  assert(Math.abs(pg - savedPage) <= 1, 'position not restored')
  assert(size === '21px', 'font size not restored')
  await page.keyboard.press('-')
})

await step('pdf view: renders original pages, zoom, page sync', async () => {
  const before = await page.$eval('#goto-page', (e) => Number(e.value))
  await page.keyboard.press('m')
  await page.waitForSelector('.reader-scroll canvas', { timeout: 15000 })
  await sleep(1500)
  const info = await page.evaluate(() => ({
    canvases: document.querySelectorAll('.reader-scroll canvas').length,
    drawn: [...document.querySelectorAll('.reader-scroll canvas')].filter((c) => c.width > 0).length,
  }))
  const pg = await page.$eval('#goto-page', (e) => Number(e.value))
  console.log(`      canvases in DOM: ${info.canvases} (${info.drawn} drawn); page ${before} → ${pg}`)
  assert(info.canvases > 0 && info.canvases < 15, 'pdf view not virtualised')
  assert(Math.abs(pg - before) <= 1, 'page not kept when switching views')
  await shot('11-pdf-view')
  await page.keyboard.press('+')
  await sleep(600)
  const zoomLabel = await page.textContent('button[data-tip="Fit to width"]')
  console.log(`      zoom now ${zoomLabel}`)
  await page.keyboard.press('m')
  await page.waitForSelector('.reader-text p')
})

await step('fullscreen: F enters distraction-free mode, controls hide', async () => {
  await page.keyboard.press('f')
  await sleep(3200)
  const state = await page.evaluate(() => ({
    fs: !!document.fullscreenElement,
    toolbarHidden: getComputedStyle(document.querySelector('[aria-label^="Start auto-scroll"], [aria-label^="Resume auto-scroll"], [aria-label^="Pause auto-scroll"]').closest('.absolute')).opacity,
  }))
  console.log(`      native fullscreen: ${state.fs}; toolbar opacity: ${state.toolbarHidden}`)
  await shot('12-fullscreen')
  assert(Number(state.toolbarHidden) < 0.5, 'controls did not hide in fullscreen')
  await page.mouse.move(700, 880)
  await sleep(500)
  const shown = await page.evaluate(() => getComputedStyle(document.querySelector('[aria-label^="Start auto-scroll"], [aria-label^="Resume auto-scroll"]').closest('.absolute')).opacity)
  assert(Number(shown) > 0.5, 'controls did not appear near the bottom edge')
  await page.keyboard.press('f')
  await sleep(300)
})

await step('keyboard: ? opens shortcut help', async () => {
  await page.keyboard.press('?')
  await page.waitForSelector('dialog[open] >> text=Keyboard shortcuts')
  await page.keyboard.press('Escape')
})

await step('library: shows progress and Continue Reading', async () => {
  await page.click('[aria-label="Back to library"]')
  await page.waitForSelector('text=Continue reading')
  const txt = await page.textContent('section[aria-labelledby="continue-heading"]')
  assert(/Page [\d,]+ of 1,500/.test(txt), 'continue card missing page info')
  await shot('13-library')
})

// ------------------------------------------------------------------ outline + scanned
await step('outline: PDF bookmarks become the table of contents', async () => {
  await uploadFile('handbook-outline.pdf')
  await page.waitForSelector('text=Bookmarks found', { timeout: 15000 })
  await page.click('button:has-text("Extract & Read")')
  await page.waitForURL(/#\/read\//, { timeout: 60000 })
  await page.keyboard.press('t')
  const entries = await page.$$eval('aside[aria-label="Contents"] li button', (b) => b.map((x) => x.textContent))
  assert(entries.length === 6 && entries[2].startsWith('Navigation'), `outline entries: ${entries}`)
  await page.click('aside[aria-label="Contents"] li button:has-text("Weather")')
  await sleep(1000)
  const pg = await page.$eval('#goto-page', (e) => Number(e.value))
  assert(pg === 31, `Weather should be page 31, got ${pg}`)
})

await step('scanned PDF: detected, explained, opens in PDF view', async () => {
  await uploadFile('scanned-8.pdf')
  await page.waitForSelector('button:has-text("Extract & Read")', { timeout: 15000 })
  await page.click('button:has-text("Extract & Read")')
  await page.waitForURL(/#\/read\//, { timeout: 60000 })
  await page.waitForSelector('.reader-scroll canvas', { timeout: 15000 })
  await page.click('button[role=radio]:has-text("Reading View")')
  await page.waitForSelector('text=/pictures without readable text/')
  await page.waitForSelector('text=/picture without readable text/')
  await shot('14-scanned')
})

await step('OCR: presentation with text only in images becomes readable text', async () => {
  await uploadFile('slides-images.pdf')
  await page.waitForSelector('button:has-text("Extract & Read")', { timeout: 15000 })
  await page.click('button:has-text("Extract & Read")')
  await page.waitForSelector('text=Recognizing text in image pages', { timeout: 30000 })
  await page.waitForURL(/#\/read\//, { timeout: 180000 })
  await page.waitForSelector('.reader-text h1:has-text("Next Steps")', { timeout: 20000 })
  const heads = await page.$$eval('.reader-text h1', (h) => h.map((x) => x.textContent))
  const text = await page.textContent('.reader-text')
  console.log(`      headings: ${heads.join(' · ')}`)
  assert(heads.includes('Quarterly Growth Plan') && heads.includes('Three Priorities'), 'slide titles not recognized')
  assert(text.includes('answer every new enquiry within one hour'), 'body text not recognized')
  assert(!text.includes('NORTHWIND STUDIO'), 'repeated slide label not removed')
})

// ------------------------------------------------------------------ cancel + resume
await step('cancel keeps processed pages; resume continues from there', async () => {
  await uploadFile('novel-1500.pdf')
  await page.waitForSelector('button:has-text("Extract & Read")', { timeout: 30000 })
  await page.click('button:has-text("Extract & Read")')
  await page.waitForSelector('text=/Extracting page [\\d,]+ of 1,500/', { timeout: 30000 })
  await page.click('button:has-text("Cancel")')
  await page.waitForSelector('text=Extraction paused', { timeout: 15000 })
  const kept = await page.textContent('button:has-text("extracted pages")')
  const n = Number(kept.replace(/\D/g, ''))
  console.log(`      cancelled with ${n} pages kept`)
  assert(n > 0 && n < 1500, 'no pages kept')
  await page.click('button:has-text("Resume extraction")')
  await page.waitForURL(/#\/read\//, { timeout: 180000 })
  await page.waitForSelector('.reader-text p')
})

// ------------------------------------------------------------------ responsive
await step('responsive: tablet and phone layouts', async () => {
  await page.setViewportSize({ width: 820, height: 1180 })
  await sleep(600)
  await shot('15-tablet-reader')
  await page.setViewportSize({ width: 390, height: 844 })
  await sleep(600)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
  await shot('16-phone-reader')
  await page.goto(`${BASE}/#/`)
  await page.waitForSelector('text=Your library')
  await shot('17-phone-library')
  assert(!overflow, 'horizontal overflow on phone')
  await page.setViewportSize({ width: 1440, height: 900 })
})

const failed = results.filter((r) => !r.ok)
const relevantErrors = consoleErrors.filter((e) => !/Download the React DevTools|favicon/.test(e))
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (relevantErrors.length) console.log(`\nConsole errors (${relevantErrors.length}):\n  ` + [...new Set(relevantErrors)].slice(0, 15).join('\n  '))
await browser.close()
process.exit(failed.length ? 1 : 0)
