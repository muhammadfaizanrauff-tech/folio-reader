import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { usePageStore } from './pageStore'
import { readingLine, useVirtualList, type Anchor } from './useVirtualList'
import type { ScrollController } from './scrollController'
import { fontStack } from '../storage/settings'
import { GUTTER, setSampleText } from './lineWidth'
import { findMatches } from '../utils/search'
import type { Block, Book, PageRecord, ReadingSettings } from '../types'
import { Icon } from '../components/Icon'
import { snapToWordStart, useSpeech, type SpeechPos, type SpeechReader } from './speech'

export interface ReaderHandle {
  jumpTo: (page: number, frac?: number) => void
  /** Scroll so a block (optionally a highlighted match inside it) is comfortably in view. */
  jumpToBlock: (page: number, block: number, highlight?: boolean) => void
  getAnchor: () => Anchor
  /** Where read-aloud should start for "read from the current view". */
  getReadingStart: () => SpeechPos
}

export interface ActiveMatch {
  page: number
  block: number
  start: number
}

interface Props {
  book: Book
  settings: ReadingSettings
  controller: ScrollController
  initialAnchor: Anchor | null
  onPosition: (top: Anchor, reading: Anchor) => void
  onOpenPdfAt: (page: number) => void
  onTap?: () => void
  query: string
  wholeWord: boolean
  activeMatch: ActiveMatch | null
  /** Changes whenever new pages were extracted (live extraction). */
  extractionTick: number
  speech: SpeechReader
  /** Keep the spoken sentence in view. */
  followSpeech: boolean
  /** Clicked on a word: position of that word. */
  onWordClick?: (pos: SpeechPos, x: number, y: number) => void
}

const SENTENCE_END = /[.!?:;…"”’')\]»]$/

export const TextReader = memo(
  forwardRef<ReaderHandle, Props>(function TextReader(props, ref) {
    const { book, settings, controller, initialAnchor, onPosition, onOpenPdfAt, onTap, query, wholeWord, activeMatch, extractionTick, speech, followSpeech, onWordClick } = props
    const tts = useSpeech(speech)
    const store = usePageStore(book.id)
    const scrollerRef = useRef<HTMLDivElement | null>(null)
    const contentRef = useRef<HTMLDivElement | null>(null)
    const [containerWidth, setContainerWidth] = useState(0)

    const setScroller = useCallback(
      (el: HTMLDivElement | null) => {
        scrollerRef.current = el
        controller.attach(el, contentRef.current)
      },
      [controller],
    )
    const setContent = useCallback(
      (el: HTMLDivElement | null) => {
        contentRef.current = el
        controller.attach(scrollerRef.current, el)
      },
      [controller],
    )

    useEffect(() => {
      const el = scrollerRef.current
      if (!el) return
      const ro = new ResizeObserver(() => setContainerWidth(el.clientWidth))
      ro.observe(el)
      return () => ro.disconnect()
    }, [])

    // Re-read pages that weren't extracted yet whenever extraction progresses.
    useEffect(() => {
      if (extractionTick) store.invalidateMissing()
    }, [extractionTick, store])

    const contentWidth = Math.max(260, Math.min(settings.readingWidth, (containerWidth || 800) - GUTTER * 2))
    const { fontSize, lineHeight, paragraphSpacing, showPageMarkers, fontFamily, textAlign } = settings

    const estimate = useCallback(
      (i: number) => {
        const chars = book.pageChars[i] ?? 0
        const blocks = book.pageBlocks[i] ?? 0
        const marker = showPageMarkers ? fontSize * 4 : 0
        const title = i === 0 ? 260 : 0
        const end = i === book.pageCount - 1 ? 240 : 0
        if (i >= book.processedPages || chars === 0) return 110 + marker + title + end
        const charWidth = fontSize * 0.5
        const charsPerLine = Math.max(10, contentWidth / charWidth)
        const lines = chars / charsPerLine + blocks * 0.55
        return lines * fontSize * lineHeight + blocks * paragraphSpacing * fontSize + marker + title + end
      },
      [book.pageChars, book.pageBlocks, book.pageCount, book.processedPages, contentWidth, fontSize, lineHeight, paragraphSpacing, showPageMarkers],
    )

    const layoutKey = `${fontFamily}|${fontSize}|${lineHeight}|${paragraphSpacing}|${Math.round(contentWidth)}|${textAlign}|${showPageMarkers}`

    const vl = useVirtualList({
      count: book.pageCount,
      estimate,
      layoutKey,
      estimateKey: book.processedPages,
      controller,
      overscan: 1600,
      initialAnchor,
      onScrollPosition: onPosition,
    })

    // Load the pages around the viewport (plus a small prefetch margin).
    useEffect(() => {
      store.ensure(Math.max(1, vl.start + 1 - 3), Math.min(book.pageCount, vl.end + 1 + 3))
    }, [vl.start, vl.end, store, book.pageCount, extractionTick])

    // Calibrate the words-per-line figure with real prose from this book.
    const pagesVersion = store.getVersion()
    useEffect(() => {
      for (let n = vl.start + 1; n <= vl.end + 1; n++) {
        const para = store.get(n)?.blocks.find((b) => b.t === 'p' && b.x.length > 400)
        if (para) {
          const cut = para.x.slice(0, 900)
          setSampleText(cut.slice(0, cut.lastIndexOf(' ')))
          return
        }
      }
    }, [vl.start, vl.end, store, pagesVersion])

    // ---- imperative navigation ----
    const pendingJump = useRef(0)
    const alignElement = useCallback(
      /** mode 'top': just below the top bar (headings); 'focus': a third down the screen (search hits). */
      (find: () => Element | null, mode: 'top' | 'focus', attempts = 40) => {
        const id = ++pendingJump.current
        let tries = 0
        let aligned = 0
        const step = () => {
          if (id !== pendingJump.current) return
          const scroller = scrollerRef.current
          const el = find()
          if (scroller && el) {
            const offset = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top
            const want = mode === 'top' ? Math.max(0, readingLine(scroller) - 40) : scroller.clientHeight * 0.3
            if (Math.abs(offset - want) > 2) controller.setTop(scroller.scrollTop + offset - want)
            // Align twice: the first alignment can render/measure more pages.
            if (++aligned >= 2) return
          }
          if (++tries < attempts) requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      },
      [controller],
    )

    useImperativeHandle(
      ref,
      () => ({
        jumpTo: (page, frac = 0) => {
          pendingJump.current++
          vl.scrollToAnchor({ index: page - 1, frac })
        },
        jumpToBlock: (page, block, highlight) => {
          const blocks = book.pageBlocks[page - 1] || 1
          vl.scrollToAnchor({ index: page - 1, frac: Math.min(0.95, block / blocks) })
          alignElement(() => {
            const pageEl = contentRef.current?.querySelector(`[data-page="${page}"]`)
            if (!pageEl || pageEl.getAttribute('data-loaded') !== '1') return null
            return (highlight && pageEl.querySelector('mark[data-active]')) || pageEl.querySelector(`[data-block="${block}"]`)
          }, highlight ? 'focus' : 'top')
        },
        getAnchor: vl.getAnchor,
        getReadingStart: () => {
          const scroller = scrollerRef.current
          const content = contentRef.current
          const fallback = { page: vl.getAnchor().index + 1, block: 0, offset: 0 }
          if (!scroller || !content) return fallback
          const line = scroller.getBoundingClientRect().top + readingLine(scroller)
          for (const el of content.querySelectorAll<HTMLElement>('section[data-loaded="1"] [data-block]')) {
            const r = el.getBoundingClientRect()
            if (r.bottom <= line) continue
            const page = Number(el.closest('section')?.getAttribute('data-page'))
            const block = Number(el.getAttribute('data-block'))
            // Paragraph already partly scrolled past: start at the line under the reading line.
            let offset = 0
            if (r.top < line) {
              const o = offsetFromPoint(el, r.left + 2, line + 4)
              if (o !== null) offset = snapToWordStart(el.textContent ?? '', o)
            }
            return { page, block, offset }
          }
          return fallback
        },
      }),
      [vl, book.pageBlocks, alignElement],
    )

    // ---- read-aloud: keep the spoken text in view ----
    const scrollAnim = useRef(0)
    const smoothScrollTo = useCallback(
      (target: number) => {
        const el = scrollerRef.current
        if (!el) return
        cancelAnimationFrame(scrollAnim.current)
        const from = el.scrollTop
        const t0 = performance.now()
        const dur = 420
        const tick = (now: number) => {
          const t = Math.min(1, (now - t0) / dur)
          const e = 1 - Math.pow(1 - t, 3)
          controller.setTop(from + (target - from) * e)
          if (t < 1) scrollAnim.current = requestAnimationFrame(tick)
        }
        scrollAnim.current = requestAnimationFrame(tick)
      },
      [controller],
    )
    useEffect(() => () => cancelAnimationFrame(scrollAnim.current), [])

    const ttsActive = tts.status !== 'idle' && !!tts.sentence
    const ttsKey = `${tts.page}:${tts.block}:${tts.sentence?.[0]}:${tts.word?.[0]}`
    useEffect(() => {
      if (!followSpeech || !ttsActive) return
      const scroller = scrollerRef.current
      const pageEl = contentRef.current?.querySelector(`section[data-page="${tts.page}"][data-loaded="1"]`)
      const el = pageEl?.querySelector('.tts-w') ?? pageEl?.querySelector('.tts-s') ?? pageEl?.querySelector(`[data-block="${tts.block}"]`)
      if (!scroller) return
      if (!el) {
        // Spoken text isn't rendered (reading moved past the rendered pages): jump there.
        const blocks = book.pageBlocks[tts.page - 1] || 1
        vl.scrollToAnchor({ index: tts.page - 1, frac: Math.min(0.95, tts.block / blocks) })
        alignElement(() => {
          const p = contentRef.current?.querySelector(`section[data-page="${tts.page}"][data-loaded="1"]`)
          return p?.querySelector('.tts-s') ?? p?.querySelector(`[data-block="${tts.block}"]`) ?? null
        }, 'focus')
        return
      }
      const r = el.getBoundingClientRect()
      const s = scroller.getBoundingClientRect()
      const y = r.top - s.top
      if (y < s.height * 0.12 || r.bottom - s.top > s.height * 0.7) smoothScrollTo(scroller.scrollTop + y - s.height * 0.3)
      // eslint-disable-next-line react-hooks/exhaustive-deps -- ttsKey captures the spoken position
    }, [ttsKey, followSpeech, ttsActive])

    const style = useMemo(
      () =>
        ({
          '--reader-font': fontStack(fontFamily),
          '--reader-size': `${fontSize}px`,
          '--reader-leading': lineHeight,
          '--reader-para': `${paragraphSpacing}em`,
          '--reader-align': textAlign,
          width: contentWidth,
        }) as CSSProperties,
      [fontFamily, fontSize, lineHeight, paragraphSpacing, textAlign, contentWidth],
    )

    const pages: ReactNode[] = []
    for (let i = vl.start; i <= vl.end; i++) {
      const n = i + 1
      const rec = store.get(n)
      let continues = false
      if (!showPageMarkers && rec && rec.blocks[0]?.t === 'p') {
        const prev = store.get(n - 1)
        const last = prev?.blocks[prev.blocks.length - 1]
        continues = !!last && last.t === 'p' && !SENTENCE_END.test(last.x) && /^[\p{Ll}\d,;]/u.test(rec.blocks[0].x)
      }
      pages.push(
        <PageView
          key={n}
          index={i}
          pageNumber={n}
          record={rec}
          extracted={n <= book.processedPages}
          showMarker={showPageMarkers}
          continues={continues}
          isFirst={i === 0}
          isLast={i === book.pageCount - 1}
          title={book.title}
          author={book.author}
          itemRef={vl.itemRef}
          onOpenPdfAt={onOpenPdfAt}
          query={query}
          wholeWord={wholeWord}
          active={activeMatch && activeMatch.page === n ? activeMatch : null}
          tts={ttsActive && tts.page === n ? tts : null}
        />,
      )
    }

    return (
      <div
        ref={setScroller}
        tabIndex={-1}
        className="reader-scroll h-full w-full"
        aria-label={`${book.title} – reading view`}
        onClick={(e) => {
          const t = e.target as HTMLElement
          if (t.closest('button,a,input')) return
          if (window.getSelection()?.toString()) return
          const blockEl = t.closest<HTMLElement>('[data-block]')
          const pageEl = t.closest('section[data-page]')
          if (blockEl && pageEl && onWordClick) {
            const o = offsetFromPoint(blockEl, e.clientX, e.clientY)
            if (o !== null) {
              const offset = snapToWordStart(blockEl.textContent ?? '', o)
              onWordClick({ page: Number(pageEl.getAttribute('data-page')), block: Number(blockEl.getAttribute('data-block')), offset }, e.clientX, e.clientY)
              return
            }
          }
          onTap?.()
        }}
      >
        <div ref={setContent} className="flex justify-center" style={{ paddingTop: vl.padTop, paddingBottom: vl.padBottom }}>
          <div className="reader-text" style={style} role="document">
            {pages}
          </div>
        </div>
      </div>
    )
  }),
)

interface PageViewProps {
  index: number
  pageNumber: number
  record: PageRecord | null | undefined
  extracted: boolean
  showMarker: boolean
  continues: boolean
  isFirst: boolean
  isLast: boolean
  title: string
  author?: string
  itemRef: (el: HTMLElement | null) => void
  onOpenPdfAt: (page: number) => void
  query: string
  wholeWord: boolean
  active: ActiveMatch | null
  tts: { block: number; sentence: [number, number] | null; word: [number, number] | null } | null
}

const PageView = memo(function PageView({
  index,
  pageNumber,
  record,
  extracted,
  showMarker,
  continues,
  isFirst,
  isLast,
  title,
  author,
  itemRef,
  onOpenPdfAt,
  query,
  wholeWord,
  active,
  tts,
}: PageViewProps) {
  const loaded = record !== undefined
  let body: ReactNode
  if (record === undefined) {
    body = <Skeleton />
  } else if (record === null || !extracted) {
    body = <PageNote>{extracted ? 'This page is not available.' : 'This page hasn’t been extracted yet.'}</PageNote>
  } else if (record.status === 'error') {
    body = (
      <PageNote>
        This page couldn’t be extracted.{' '}
        <button type="button" className="font-medium text-accent hover:underline" onClick={() => onOpenPdfAt(pageNumber)}>
          View it in PDF view
        </button>
      </PageNote>
    )
  } else if (record.status === 'empty' && record.blocks.length === 0) {
    body = (
      <PageNote>
        No text on this page – it may be an image or a scanned page.{' '}
        <button type="button" className="font-medium text-accent hover:underline" onClick={() => onOpenPdfAt(pageNumber)}>
          View it in PDF view
        </button>
      </PageNote>
    )
  } else {
    body = record.blocks.map((b, i) => (
      <BlockView
        key={i}
        block={b}
        index={i}
        cont={i === 0 && continues}
        query={query}
        wholeWord={wholeWord}
        activeStart={active && active.block === i ? active.start : -1}
        s0={tts && tts.block === i && tts.sentence ? tts.sentence[0] : -1}
        s1={tts && tts.block === i && tts.sentence ? tts.sentence[1] : -1}
        w0={tts && tts.block === i && tts.word ? tts.word[0] : -1}
        w1={tts && tts.block === i && tts.word ? tts.word[1] : -1}
      />
    ))
  }

  return (
    <section ref={itemRef} data-index={index} data-page={pageNumber} data-loaded={loaded ? '1' : '0'} className="page flow-root" aria-label={`Page ${pageNumber}`}>
      {isFirst && (
        <header className="pb-6 pt-20 text-center">
          <p style={{ textAlign: 'center' }} className="!m-0 font-sans text-[11px] font-medium uppercase tracking-[0.3em] text-ink-faint">{author || ' '}</p>
          <h1 className="!m-0 !mt-4 !text-[1.9em] !leading-tight">{title}</h1>
          <div className="mx-auto mt-10 h-px w-16 bg-line-strong" />
        </header>
      )}
      {showMarker && !isFirst && (
        <div className="page-marker" aria-hidden="true">
          {pageNumber}
        </div>
      )}
      {body}
      {isLast && (
        <footer className="pb-40 pt-24 text-center text-ink-faint">
          <div className="mx-auto mb-6 h-px w-16 bg-line-strong" />
          <p className="font-sans text-[11px] uppercase tracking-[0.3em]">End of book</p>
        </footer>
      )}
    </section>
  )
})

const BlockView = memo(function BlockView({
  block,
  index,
  cont,
  query,
  wholeWord,
  activeStart,
  s0,
  s1,
  w0,
  w1,
}: {
  block: Block
  index: number
  cont: boolean
  query: string
  wholeWord: boolean
  activeStart: number
  /** read-aloud sentence / word ranges inside this block (-1 = none) */
  s0: number
  s1: number
  w0: number
  w1: number
}) {
  const content = useMemo(() => renderText(block.x, query, wholeWord, activeStart, s0, s1, w0, w1), [block.x, query, wholeWord, activeStart, s0, s1, w0, w1])
  const Tag = block.t === 'p' ? 'p' : block.t
  return (
    <Tag data-block={index} className={cont ? 'cont' : undefined}>
      {content}
    </Tag>
  )
})

/** Renders block text with search matches (<mark>) and the read-aloud sentence/word highlighted. */
function renderText(text: string, query: string, wholeWord: boolean, activeStart: number, s0: number, s1: number, w0: number, w1: number): ReactNode {
  const matches = query ? findMatches(text, query, { wholeWord }) : []
  const hasTts = s0 >= 0 && s1 > s0
  if (!matches.length && !hasTts) return text
  const cuts = new Set<number>([0, text.length])
  for (const m of matches) {
    cuts.add(m)
    cuts.add(Math.min(text.length, m + query.length))
  }
  if (hasTts) {
    cuts.add(s0)
    cuts.add(Math.min(text.length, s1))
    if (w0 >= 0 && w1 > w0) {
      cuts.add(w0)
      cuts.add(Math.min(text.length, w1))
    }
  }
  const points = [...cuts].sort((a, b) => a - b)
  const out: ReactNode[] = []
  let mi = 0
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    if (a >= b) continue
    while (mi < matches.length && matches[mi] + query.length <= a) mi++
    const inMatch = mi < matches.length && matches[mi] <= a && a < matches[mi] + query.length
    const inSentence = hasTts && a >= s0 && a < s1
    const inWord = inSentence && w0 >= 0 && a >= w0 && a < w1
    const seg = text.slice(a, b)
    if (!inMatch && !inSentence) {
      out.push(seg)
      continue
    }
    const cls = inWord ? 'tts-s tts-w' : inSentence ? 'tts-s' : undefined
    out.push(
      inMatch ? (
        <mark key={a} className={cls} data-active={matches[mi] === activeStart ? '' : undefined}>
          {seg}
        </mark>
      ) : (
        <span key={a} className={cls}>
          {seg}
        </span>
      ),
    )
  }
  return out
}

/** Character offset inside `blockEl`'s text at a screen point (null if the point isn't on its text). */
function offsetFromPoint(blockEl: HTMLElement, x: number, y: number): number | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  let node: Node | null = null
  let off = 0
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y)
    node = p?.offsetNode ?? null
    off = p?.offset ?? 0
  } else if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y)
    node = r?.startContainer ?? null
    off = r?.startOffset ?? 0
  }
  if (!node || !blockEl.contains(node)) return null
  if (node.nodeType !== Node.TEXT_NODE) return 0
  let total = 0
  const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT)
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (t === node) return total + off
    total += t.textContent?.length ?? 0
  }
  return null
}

function Skeleton() {
  return (
    <div aria-hidden="true" className="py-2">
      {[92, 100, 97, 100, 64, 0, 100, 95, 99, 71].map((w, i) => (w ? <div key={i} className="skeleton-line" style={{ width: `${w}%` }} /> : <div key={i} className="h-4" />))}
    </div>
  )
}

function PageNote({ children }: { children: ReactNode }) {
  return (
    <p className="!my-10 flex items-center justify-center gap-2 text-center font-sans !text-[14px] italic !leading-relaxed text-ink-faint" style={{ textAlign: 'center' }}>
      <Icon name="info" size={15} className="shrink-0" />
      <span>{children}</span>
    </p>
  )
}
