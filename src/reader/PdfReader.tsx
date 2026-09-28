import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
import { useVirtualList, type Anchor } from './useVirtualList'
import type { ScrollController } from './scrollController'
import type { ReaderHandle } from './TextReader'
import { openPdf } from '../pdf/pdfjs'
import { getFile } from '../storage/db'
import { friendlyError, type FriendlyError } from '../pdf/errors'
import { extraction } from '../extraction/manager'
import { Button } from '../components/ui'
import type { Book } from '../types'

export type PdfZoom = 'fit' | number

interface Props {
  book: Book
  controller: ScrollController
  initialAnchor: Anchor | null
  onPosition: (top: Anchor, reading: Anchor) => void
  zoom: PdfZoom
  onEffectiveScale?: (scale: number) => void
  onTap?: () => void
}

const PAGE_GAP = 20
const SIDE_PAD = 24
/** Cap canvas backing store size (~16.7 MP) to stay inside browser limits and memory. */
const MAX_CANVAS_PIXELS = 16_777_216

interface Size {
  w: number
  h: number
}

export const PdfReader = memo(
  forwardRef<ReaderHandle, Props>(function PdfReader({ book, controller, initialAnchor, onPosition, zoom, onEffectiveScale, onTap }, ref) {
    const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
    const [error, setError] = useState<FriendlyError | null>(null)
    const [password, setPassword] = useState('')
    const [attempt, setAttempt] = useState(0)
    const [baseSize, setBaseSize] = useState<Size | null>(null)
    const sizes = useRef(new Map<number, Size>())
    const [sizesVersion, setSizesVersion] = useState(0)
    const [containerWidth, setContainerWidth] = useState(0)
    const scrollerRef = useRef<HTMLDivElement | null>(null)
    const contentRef = useRef<HTMLDivElement | null>(null)

    // ---- load the stored PDF ----
    useEffect(() => {
      let doc: PDFDocumentProxy | null = null
      let alive = true
      ;(async () => {
        try {
          const blob = await getFile(book.id)
          if (!blob) throw new Error('The original PDF is not stored for this book.')
          doc = await openPdf(blob, extraction.getPassword(book.id) ?? (password || undefined))
          if (!alive) return doc.loadingTask.destroy()
          const first = await doc.getPage(1)
          const vp = first.getViewport({ scale: 1 })
          sizes.current.set(1, { w: vp.width, h: vp.height })
          setBaseSize({ w: vp.width, h: vp.height })
          setPdf(doc)
          setError(null)
        } catch (err) {
          if (alive) setError(friendlyError(err))
        }
      })()
      return () => {
        alive = false
        doc?.loadingTask.destroy()
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only on explicit retry
    }, [book.id, attempt])

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
    }, [pdf])

    const fitScale = baseSize ? Math.min(2.5, Math.max(0.2, ((containerWidth || 900) - SIDE_PAD * 2) / baseSize.w)) : 1
    const scale = zoom === 'fit' ? Math.min(fitScale, 1.6) : zoom

    useEffect(() => {
      onEffectiveScale?.(scale)
    }, [scale, onEffectiveScale])

    const sizeOf = useCallback((n: number): Size => sizes.current.get(n) ?? baseSize ?? { w: 612, h: 792 }, [baseSize])

    const estimate = useCallback(
      (i: number) => sizeOf(i + 1).h * scale + PAGE_GAP,
      // eslint-disable-next-line react-hooks/exhaustive-deps -- sizesVersion invalidates the size map
      [sizeOf, scale, sizesVersion],
    )

    const vl = useVirtualList({
      count: pdf ? pdf.numPages : 0,
      estimate,
      layoutKey: `pdf|${scale.toFixed(4)}`,
      estimateKey: sizesVersion,
      controller,
      overscan: 1200,
      initialAnchor,
      onScrollPosition: onPosition,
    })

    useImperativeHandle(
      ref,
      () => ({
        jumpTo: (page, frac = 0) => vl.scrollToAnchor({ index: page - 1, frac }),
        jumpToBlock: (page) => vl.scrollToAnchor({ index: page - 1, frac: 0 }),
        getAnchor: vl.getAnchor,
        getReadingStart: () => ({ page: vl.getAnchor().index + 1, block: 0, offset: 0 }),
      }),
      [vl],
    )

    const onSize = useCallback((n: number, s: Size) => {
      const prev = sizes.current.get(n)
      if (prev && Math.abs(prev.w - s.w) < 0.5 && Math.abs(prev.h - s.h) < 0.5) return
      sizes.current.set(n, s)
      setSizesVersion((v) => v + 1)
    }, [])

    if (error) {
      const needsPassword = error.kind === 'password-required' || error.kind === 'password-incorrect'
      return (
        <div className="flex h-full items-center justify-center px-6">
          <div className="max-w-sm text-center">
            <p className="font-serif text-xl text-ink">{error.title}</p>
            <p className="mt-2 text-[14px] text-ink-soft">{error.message}</p>
            {needsPassword && (
              <form
                className="mt-5 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  extraction.setPassword(book.id, password)
                  setAttempt((a) => a + 1)
                }}
              >
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-label="PDF password"
                  placeholder="PDF password"
                  autoFocus
                  className="h-10 min-w-0 flex-1 rounded-full border border-line-strong bg-paper px-4 text-sm text-ink outline-none focus:border-accent"
                />
                <Button type="submit" variant="primary" disabled={!password}>
                  Unlock
                </Button>
              </form>
            )}
          </div>
        </div>
      )
    }

    const pages = []
    if (pdf) {
      for (let i = vl.start; i <= vl.end; i++) {
        const n = i + 1
        const s = sizeOf(n)
        pages.push(<PdfPage key={n} pdf={pdf} index={i} pageNumber={n} width={s.w * scale} height={s.h * scale} scale={scale} itemRef={vl.itemRef} onSize={onSize} />)
      }
    }

    return (
      <div
        ref={setScroller}
        tabIndex={-1}
        className="reader-scroll h-full w-full"
        aria-label={`${book.title} – PDF view`}
        onClick={(e) => {
          if (onTap && !(e.target as HTMLElement).closest('button,a,input')) onTap()
        }}
      >
        {!pdf && (
          <div className="flex h-full items-center justify-center">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-line-strong border-t-accent" aria-label="Loading PDF" />
          </div>
        )}
        <div ref={setContent} className="flex flex-col items-center" style={{ paddingTop: vl.padTop, paddingBottom: vl.padBottom }}>
          {pages}
        </div>
      </div>
    )
  }),
)

interface PdfPageProps {
  pdf: PDFDocumentProxy
  index: number
  pageNumber: number
  width: number
  height: number
  scale: number
  itemRef: (el: HTMLElement | null) => void
  onSize: (n: number, s: Size) => void
}

const PdfPage = memo(function PdfPage({ pdf, index, pageNumber, width, height, scale, itemRef, onSize }: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [rendered, setRendered] = useState(false)

  useEffect(() => {
    let task: RenderTask | null = null
    let page: PDFPageProxy | null = null
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        page = await pdf.getPage(pageNumber)
        if (cancelled) return
        const base = page.getViewport({ scale: 1 })
        onSize(pageNumber, { w: base.width, h: base.height })
        const dpr = window.devicePixelRatio || 1
        let renderScale = scale * dpr
        const px = base.width * base.height * renderScale * renderScale
        if (px > MAX_CANVAS_PIXELS) renderScale *= Math.sqrt(MAX_CANVAS_PIXELS / px)
        const viewport = page.getViewport({ scale: renderScale })
        const canvas = canvasRef.current
        if (!canvas) return
        // Render into an offscreen canvas first so the old image stays until the new one is ready.
        const off = document.createElement('canvas')
        off.width = Math.floor(viewport.width)
        off.height = Math.floor(viewport.height)
        task = page.render({ canvas: off, viewport, background: '#ffffff' })
        await task.promise
        if (cancelled) return
        canvas.width = off.width
        canvas.height = off.height
        canvas.getContext('2d')?.drawImage(off, 0, 0)
        off.width = off.height = 0
        setRendered(true)
      } catch {
        // RenderingCancelledException or a broken page – the placeholder stays.
      }
    }, 40) // tiny delay: skip rendering pages that fly past during fast scrolling
    return () => {
      cancelled = true
      clearTimeout(timer)
      task?.cancel()
      page?.cleanup()
    }
  }, [pdf, pageNumber, scale, onSize])

  // Release the canvas memory when the page leaves the rendered window.
  useEffect(
    () => () => {
      const c = canvasRef.current
      if (c) c.width = c.height = 0
    },
    [],
  )

  return (
    <div ref={itemRef} data-index={index} data-page={pageNumber} style={{ paddingBottom: PAGE_GAP }}>
      <div className="relative overflow-hidden rounded-[3px] bg-white shadow-[0_1px_3px_rgb(0_0_0/0.12),0_8px_28px_-12px_rgb(0_0_0/0.35)]" style={{ width, height }}>
        <canvas ref={canvasRef} className="block h-full w-full" aria-label={`Page ${pageNumber}`} role="img" />
        {!rendered && <div className="absolute inset-0 flex items-center justify-center text-[13px] text-neutral-400">{pageNumber}</div>}
      </div>
    </div>
  )
})
