import { useSyncExternalStore } from 'react'
import { getPages } from '../storage/db'
import type { PageRecord } from '../types'

/**
 * Read-aloud engine built on the browser's Web Speech API (speechSynthesis).
 * Runs fully locally with the voices installed on the device.
 *
 * - Text comes from the extracted pages in IndexedDB (not the DOM), so reading
 *   continues seamlessly across the whole book, beyond the rendered pages.
 * - The book is spoken one sentence at a time. Short utterances avoid the
 *   well-known Chrome bug that cuts long utterances off, and they give us
 *   precise positions for highlighting and for skipping back and forth.
 * - Word boundaries (when the voice reports them) drive word highlighting.
 * - Pause is implemented as cancel + remember the current word, and resume
 *   restarts from that word. That is more reliable across browsers than
 *   speechSynthesis.pause()/resume().
 */

export interface SpeechPos {
  page: number
  block: number
  /** character offset inside the block */
  offset: number
}

export type SpeechStatus = 'idle' | 'loading' | 'playing' | 'paused'

export interface SpeechSnapshot {
  status: SpeechStatus
  page: number
  block: number
  /** [start, end) of the sentence being spoken, inside the block text */
  sentence: [number, number] | null
  /** [start, end) of the word being spoken (if the voice reports word boundaries) */
  word: [number, number] | null
  error?: string
}

export const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'

const MAX_CHUNK = 240

/** Splits text into sentence ranges; very long sentences are split further at commas/spaces. */
export function splitSentences(text: string, lang?: string): [number, number][] {
  const out: [number, number][] = []
  const push = (s: number, e: number) => {
    // trim whitespace from the range
    while (s < e && /\s/.test(text[s])) s++
    while (e > s && /\s/.test(text[e - 1])) e--
    if (e <= s) return
    while (e - s > MAX_CHUNK) {
      const slice = text.slice(s, s + MAX_CHUNK)
      let cut = Math.max(slice.lastIndexOf(', '), slice.lastIndexOf('; '), slice.lastIndexOf(': '))
      if (cut < MAX_CHUNK * 0.4) cut = slice.lastIndexOf(' ')
      if (cut <= 0) cut = MAX_CHUNK
      out.push([s, s + cut + 1])
      s = s + cut + 1
      while (s < e && /\s/.test(text[s])) s++
    }
    if (e > s) out.push([s, e])
  }
  const Seg = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter
  if (Seg) {
    const seg = new Seg(lang || undefined, { granularity: 'sentence' })
    for (const part of seg.segment(text)) push(part.index, part.index + part.segment.length)
  } else {
    const re = /[^.!?…]+[.!?…]+["'”’)\]]*\s*|[^.!?…]+$/g
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) push(m.index, m.index + m[0].length)
  }
  return out
}

function wordEnd(text: string, start: number): number {
  const m = /^[\p{L}\p{N}'’-]+/u.exec(text.slice(start))
  return start + (m ? m[0].length : 1)
}

/** Start of the word containing `offset`. */
export function snapToWordStart(text: string, offset: number): number {
  let i = Math.max(0, Math.min(offset, text.length))
  while (i > 0 && !/\s/.test(text[i - 1])) i--
  return i
}

export class SpeechReader {
  private gen = 0
  private utter: SpeechSynthesisUtterance | null = null
  private cache = new Map<number, PageRecord | null>()
  private snap: SpeechSnapshot = { status: 'idle', page: 1, block: 0, sentence: null, word: null }
  private listeners = new Set<() => void>()
  private resumeAt: SpeechPos | null = null
  private readonly bookId: string
  private readonly pageCount: number
  private voiceURI = ''
  private rate = 1

  constructor(bookId: string, pageCount: number) {
    this.bookId = bookId
    this.pageCount = pageCount
  }

  // ---------- store ----------
  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  getSnapshot = () => this.snap
  private set(patch: Partial<SpeechSnapshot>) {
    this.snap = { ...this.snap, ...patch }
    this.listeners.forEach((l) => l())
  }

  get status(): SpeechStatus {
    return this.snap.status
  }
  get active(): boolean {
    return this.snap.status !== 'idle'
  }

  /** Current position (word if known, otherwise sentence start). */
  currentPos(): SpeechPos | null {
    const s = this.snap
    if (s.status === 'paused') return this.resumeAt
    if (!s.sentence) return null
    return { page: s.page, block: s.block, offset: s.word?.[0] ?? s.sentence[0] }
  }

  configure(opts: { voiceURI?: string; rate?: number }) {
    const changed = (opts.voiceURI !== undefined && opts.voiceURI !== this.voiceURI) || (opts.rate !== undefined && opts.rate !== this.rate)
    if (opts.voiceURI !== undefined) this.voiceURI = opts.voiceURI
    if (opts.rate !== undefined) this.rate = opts.rate
    // Apply immediately: restart the current sentence from the current word.
    if (changed && this.snap.status === 'playing') {
      const pos = this.currentPos()
      if (pos) this.start(pos)
    }
  }

  // ---------- data ----------
  private async loadPage(page: number): Promise<PageRecord | null> {
    if (this.cache.has(page)) return this.cache.get(page) ?? null
    const from = page
    const to = Math.min(this.pageCount, page + 4)
    const recs = await getPages(this.bookId, from, to)
    const found = new Map(recs.map((r) => [r.page, r]))
    for (let p = from; p <= to; p++) this.cache.set(p, found.get(p) ?? null)
    if (this.cache.size > 80) {
      for (const k of this.cache.keys()) {
        if (k < page - 10 || k > page + 20) this.cache.delete(k)
        if (this.cache.size <= 60) break
      }
    }
    return this.cache.get(page) ?? null
  }

  /** Forget cached pages that weren't extracted yet (used during live extraction). */
  invalidateMissing() {
    for (const [k, v] of this.cache) if (v === null) this.cache.delete(k)
  }

  // ---------- control ----------
  start(pos: SpeechPos) {
    if (!speechSupported) return
    const g = ++this.gen
    speechSynthesis.cancel()
    this.resumeAt = null
    this.set({ status: 'loading', page: pos.page, block: pos.block, error: undefined })
    this.run(pos, g).catch((err) => {
      if (g !== this.gen) return
      this.set({ status: 'idle', sentence: null, word: null, error: String(err?.message ?? err) })
    })
  }

  pause() {
    if (this.snap.status !== 'playing' && this.snap.status !== 'loading') return
    const pos = this.currentPos()
    this.gen++
    speechSynthesis.cancel()
    this.resumeAt = pos ?? { page: this.snap.page, block: this.snap.block, offset: 0 }
    this.set({ status: 'paused' })
  }

  resume() {
    if (this.snap.status !== 'paused' || !this.resumeAt) return
    this.start(this.resumeAt)
  }

  toggle() {
    if (this.snap.status === 'playing' || this.snap.status === 'loading') this.pause()
    else if (this.snap.status === 'paused') this.resume()
  }

  stop() {
    this.gen++
    if (this.utter) {
      this.utter.onboundary = null
      this.utter = null
    }
    if (speechSupported) speechSynthesis.cancel()
    this.resumeAt = null
    this.set({ status: 'idle', sentence: null, word: null })
  }

  /** Jump to the next (+1) or previous (-1) sentence. */
  async skip(dir: 1 | -1) {
    const s = this.snap
    const pos = this.currentPos()
    if (!pos || !s.sentence) return
    const rec = await this.loadPage(pos.page)
    const text = rec?.blocks[pos.block]?.x ?? ''
    const sentences = splitSentences(text)
    const cur = sentences.findIndex(([a, b]) => pos.offset >= a && pos.offset < b)
    const idx = cur < 0 ? 0 : cur
    if (dir > 0) {
      if (idx + 1 < sentences.length) return this.startOrQueue({ ...pos, offset: sentences[idx + 1][0] })
      return this.startOrQueue({ page: pos.page, block: pos.block + 1, offset: 0 })
    }
    // Back: restart the current sentence if we're well into it, otherwise go to the previous one.
    if (pos.offset - sentences[idx][0] > 12 && s.status !== 'paused') return this.startOrQueue({ ...pos, offset: sentences[idx][0] })
    if (idx > 0) return this.startOrQueue({ ...pos, offset: sentences[idx - 1][0] })
    // previous block (possibly on an earlier page)
    let page = pos.page
    let block = pos.block - 1
    while (page >= 1) {
      const r = await this.loadPage(page)
      if (r && block >= 0 && block < r.blocks.length) {
        const prev = splitSentences(r.blocks[block].x)
        return this.startOrQueue({ page, block, offset: prev.length ? prev[prev.length - 1][0] : 0 })
      }
      page--
      const pr = page >= 1 ? await this.loadPage(page) : null
      block = pr ? pr.blocks.length - 1 : -1
    }
    return this.startOrQueue({ page: 1, block: 0, offset: 0 })
  }

  private startOrQueue(pos: SpeechPos) {
    if (this.snap.status === 'paused') {
      this.resumeAt = pos
      this.set({ page: pos.page, block: pos.block, sentence: [pos.offset, pos.offset], word: null })
    } else this.start(pos)
  }

  dispose() {
    this.stop()
    this.listeners.clear()
  }

  // ---------- speaking loop ----------
  private async run(pos: SpeechPos, g: number) {
    let { page, block, offset } = pos
    while (page <= this.pageCount) {
      const rec = await this.loadPage(page)
      if (g !== this.gen) return
      if (rec && rec.status !== 'error') {
        for (; block < rec.blocks.length; block++) {
          const text = rec.blocks[block].x
          for (const [a, b] of splitSentences(text)) {
            if (b <= offset) continue
            const ok = await this.speak(text, Math.max(a, offset), b, page, block, g)
            if (!ok || g !== this.gen) return
          }
          offset = 0
        }
      }
      page++
      block = 0
      offset = 0
    }
    if (g === this.gen) this.set({ status: 'idle', sentence: null, word: null })
  }

  private pickVoice(): SpeechSynthesisVoice | null {
    const voices = speechSynthesis.getVoices()
    if (!voices.length) return null
    if (this.voiceURI) {
      const v = voices.find((x) => x.voiceURI === this.voiceURI)
      if (v) return v
    }
    return defaultVoice(voices)
  }

  private speak(text: string, start: number, end: number, page: number, block: number, g: number): Promise<boolean> {
    return new Promise((resolve) => {
      const chunk = text.slice(start, end)
      if (!chunk.trim()) return resolve(true)
      const u = new SpeechSynthesisUtterance(chunk)
      const voice = this.pickVoice()
      if (voice) {
        u.voice = voice
        u.lang = voice.lang
      }
      u.rate = this.rate
      this.utter = u // keep a reference: Chrome drops events of garbage-collected utterances
      this.set({ status: 'playing', page, block, sentence: [start, end], word: null })
      let settled = false
      const done = (ok: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(watchdog)
        resolve(ok)
      }
      u.onboundary = (e) => {
        if (g !== this.gen || (e.name && e.name !== 'word')) return
        const ws = start + e.charIndex
        const we = e.charLength ? ws + e.charLength : wordEnd(text, ws)
        this.set({ word: [ws, Math.min(we, end)] })
      }
      u.onend = () => done(g === this.gen)
      u.onerror = (e) => {
        if (g === this.gen && e.error !== 'interrupted' && e.error !== 'canceled') {
          this.set({ status: 'idle', sentence: null, word: null, error: speechErrorMessage(e.error) })
        }
        done(false)
      }
      // Safety net: some engines occasionally never fire `end`.
      const watchdog = setTimeout(() => done(g === this.gen), Math.max(8000, (chunk.length / Math.max(0.3, this.rate)) * 180))
      speechSynthesis.speak(u)
    })
  }
}

function speechErrorMessage(code: string): string {
  switch (code) {
    case 'not-allowed':
      return 'The browser blocked speech. Click the Read aloud button to start it.'
    case 'synthesis-unavailable':
    case 'voice-unavailable':
      return 'No speech voice is available. Install a voice in your system settings and try again.'
    case 'network':
      return 'This voice needs an internet connection. Choose a different (local) voice.'
    default:
      return 'Read aloud stopped unexpectedly. Try again or choose another voice.'
  }
}

// macOS ships joke/effect voices that are unsuitable for reading books.
const NOVELTY = new Set(
  'Albert,Bad News,Bahh,Bells,Boing,Bubbles,Cellos,Deranged,Good News,Hysterical,Jester,Organ,Pipe Organ,Superstar,Trinoids,Whisper,Wobble,Zarvox'.split(','),
)

export function isNoveltyVoice(v: SpeechSynthesisVoice): boolean {
  return NOVELTY.has(v.name.replace(/\s*\(.*\)$/, ''))
}

/** Prefer a natural, local (offline) voice in the user's language; local voices also report word boundaries. */
export function defaultVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const lang = (navigator.language || 'en').toLowerCase()
  const base = lang.split('-')[0]
  const score = (v: SpeechSynthesisVoice) =>
    (isNoveltyVoice(v) ? -100 : 0) +
    (v.lang.toLowerCase() === lang ? 8 : v.lang.toLowerCase().startsWith(base) ? 4 : 0) +
    (v.localService ? 2 : 0) +
    (v.default ? 1.5 : 0) +
    (/premium|enhanced|natural|neural/i.test(v.name) ? 1 : 0) +
    (/^(samantha|daniel|karen|moira|alex|ava|zoe|serena|tom)\b/i.test(v.name) ? 0.5 : 0)
  return [...voices].sort((a, b) => score(b) - score(a))[0] ?? null
}

// ---------- voices hook ----------
let voiceList: SpeechSynthesisVoice[] = speechSupported ? speechSynthesis.getVoices() : []
const voiceListeners = new Set<() => void>()
if (speechSupported) {
  speechSynthesis.addEventListener?.('voiceschanged', () => {
    voiceList = speechSynthesis.getVoices()
    voiceListeners.forEach((l) => l())
  })
}

export function useVoices(): SpeechSynthesisVoice[] {
  return useSyncExternalStore(
    (l) => {
      voiceListeners.add(l)
      return () => voiceListeners.delete(l)
    },
    () => voiceList,
    () => voiceList,
  )
}

export function useSpeech(reader: SpeechReader): SpeechSnapshot {
  return useSyncExternalStore(reader.subscribe, reader.getSnapshot, reader.getSnapshot)
}
