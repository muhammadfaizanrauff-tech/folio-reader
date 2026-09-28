// Read-aloud tests. Headless Chrome can't produce audio, so a simulated speech
// engine (word boundaries every 50 ms, then \`end\`) replaces speechSynthesis.
//   npm run dev   (port 5173, or set BASE_URL)   then   npm run test:tts
import { chromium } from 'playwright-core'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
let failed = 0
const b = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 })
// Simulated speech engine: fires word boundaries every 50ms, then `end`.
await ctx.addInitScript(() => {
  const spoken = []; window.__spoken = spoken
  const fake = {
    speaking: false, pending: false, paused: false, _cur: null, _timers: [],
    getVoices: () => [{ name: 'Test Voice', lang: 'en-US', voiceURI: 'test', localService: true, default: true }],
    addEventListener() {}, removeEventListener() {},
    speak(u) {
      spoken.push(u.text); this._cur = u; this.speaking = true
      const words = [...u.text.matchAll(/\S+/g)]; let i = 0
      const next = () => {
        if (this._cur !== u) return
        if (i < words.length) { u.onboundary?.({ name: 'word', charIndex: words[i].index, charLength: words[i][0].length }); i++; this._timers.push(setTimeout(next, 50)) }
        else { this.speaking = false; this._cur = null; u.onend?.({}) }
      }
      this._timers.push(setTimeout(next, 20))
    },
    cancel() { const u = this._cur; this._cur = null; this.speaking = false; this._timers.forEach(clearTimeout); this._timers = []; if (u) u.onerror?.({ error: 'interrupted' }) },
    pause() {}, resume() {},
  }
  Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true })
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; this.rate = 1 } }
})
const p = await ctx.newPage()
const errs = []; p.on('pageerror', e => errs.push(e.message))
const ok = (c, m) => {
  if (!c) failed++
  console.log((c ? '  ✓ ' : '  ✗ ') + m)
}
const sleep = ms => p.waitForTimeout(ms)
await p.goto(`${BASE}/#/`)
await p.setInputFiles('input[type=file]', join(here, 'fixtures', 'novel-1500.pdf'))
await p.click('button:has-text("Extract & Read")', { timeout: 30000 })
await p.waitForURL(/#\/read\//, { timeout: 120000 }); await p.waitForSelector('.reader-text p')
await p.mouse.move(750, 500); await sleep(300)

// 1. Off by default: clicking text does nothing speech-related, auto-scroll works
ok(!(await p.$('[aria-label="Read aloud controls"]')), 'read aloud is off by default (no listening bar)')
await p.click('.reader-text p >> nth=1', { position: { x: 60, y: 10 } }); await sleep(200)
ok(!(await p.$('text=Read aloud from here')), 'clicking a word does nothing while the feature is off')
let t0 = await p.$eval('.reader-scroll', e => e.scrollTop)
await p.keyboard.press('Space'); await sleep(1200)
ok((await p.$eval('.reader-scroll', e => e.scrollTop)) > t0 + 10, 'Space still runs auto-scroll with the voice off')
await p.keyboard.press('Space')

// 2. Turn it on from the toolbar
await p.mouse.move(750, 900); await sleep(300)
await p.click('[aria-label^="Turn on Read aloud"]'); await sleep(200)
ok(!!(await p.$('[aria-label="Read aloud controls"]')), 'toolbar button turns Read aloud on (listening bar appears)')
await p.screenshot({ path: join(here, 'screenshots', '20-read-aloud-on.png') })

// 3. Click a word → "Read aloud from here" → starts at that word
const para = await p.$('.reader-text p >> nth=2')
const box = await para.boundingBox()
await p.mouse.click(box.x + 200, box.y + 12); await sleep(200)
ok(!!(await p.$('text=Read aloud from here')), 'clicking a word offers "Read aloud from here"')
const wordAt = await p.evaluate(({ x, y }) => { const r = document.caretRangeFromPoint(x, y); const t = r.startContainer.textContent; let i = r.startOffset; while (i > 0 && !/\s/.test(t[i - 1])) i--; return t.slice(i, i + 25) }, { x: box.x + 200, y: box.y + 12 })
await p.click('text=Read aloud from here'); await sleep(400)
const first = await p.evaluate(() => window.__spoken[0])
ok(first && first.startsWith(wordAt.split(' ')[0]), `speech started at the clicked word ("${wordAt.split(' ')[0]}" → "${(first || '').slice(0, 30)}…")`)
ok(!!(await p.$('.tts-s')), 'spoken sentence is highlighted')
await sleep(300)
ok(!!(await p.$('.tts-w')), 'current word is highlighted')
await p.mouse.move(750, 900); await sleep(200)
await p.screenshot({ path: join(here, 'screenshots', '21-read-aloud-speaking.png') })

// 4. Pause / resume with L
await p.keyboard.press('l'); await sleep(200)
const pausedWord = await p.evaluate(() => document.querySelector('.tts-w')?.textContent)
const n1 = await p.evaluate(() => window.__spoken.length)
await sleep(700)
ok((await p.evaluate(() => window.__spoken.length)) === n1, 'L pauses (nothing new is spoken)')
await p.keyboard.press('l'); await sleep(200)
const resumed = await p.evaluate(() => window.__spoken.at(-1))
ok(resumed.startsWith(pausedWord ?? '§'), `L resumes from the paused word ("${pausedWord}")`)

// 5. Next sentence
const before = await p.evaluate(() => window.__spoken.length)
await p.click('[aria-label="Next sentence"]'); await sleep(200)
ok((await p.evaluate(() => window.__spoken.length)) > before, 'next-sentence button skips ahead')

// 6. Keeps going and follows: let it run through several sentences
const top0 = await p.$eval('.reader-scroll', e => e.scrollTop)
await sleep(9000)
const top1 = await p.$eval('.reader-scroll', e => e.scrollTop)
const vis = await p.evaluate(() => { const el = document.querySelector('.tts-s'); if (!el) return false; const r = el.getBoundingClientRect(); return r.top > 0 && r.top < innerHeight })
ok(top1 > top0 && vis, `page follows the voice (scrolled ${Math.round(top1 - top0)} px, spoken text visible)`)

// 7. Hand-off with auto-scroll: start auto-scroll → voice pauses
await p.keyboard.press('Space'); await sleep(400)
ok((await p.textContent('[aria-label="Read aloud controls"]')).includes('Paused'), 'starting auto-scroll pauses the voice')
// start voice again → auto-scroll pauses; turning voice off → auto-scroll continues
await p.keyboard.press('l'); await sleep(500)
await sleep(600)
await p.click('[aria-label="Turn off Read aloud"]'); await sleep(900)
const a1 = await p.$eval('.reader-scroll', e => e.scrollTop); await sleep(1000)
const a2 = await p.$eval('.reader-scroll', e => e.scrollTop)
ok(!(await p.$('[aria-label="Read aloud controls"]')), 'turning Read aloud off hides its controls')
ok(a2 - a1 > 10, `auto-scroll continues after the voice is turned off (${Math.round(a2 - a1)} px/s)`)
ok(!(await p.$('.tts-s')), 'no highlight left behind')
await p.keyboard.press('Space')

// 8. Setting persists
await p.reload(); await p.waitForSelector('.reader-text p'); await sleep(400)
ok(!(await p.$('[aria-label="Read aloud controls"]')), 'off state is remembered after reload')
if (errs.length) console.log('page errors:', errs)
await b.close()
console.log(failed ? `\n${failed} failed` : '\nall read-aloud checks passed')
process.exit(failed || errs.length ? 1 : 0)
