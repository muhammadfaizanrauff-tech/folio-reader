import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { getBook, getProgress, putProgress, updateBook } from '../storage/db'
import { getSettings, LIMITS, stepSpeed, speedLabel, updateSettings, useSettings } from '../storage/settings'
import { extraction, useExtractionJob } from '../extraction/manager'
import { navigate } from '../router'
import { ScrollController, useAutoScrollState } from './scrollController'
import { PositionStore, usePosition } from './position'
import { TextReader, type ActiveMatch, type ReaderHandle } from './TextReader'
import { PdfReader, type PdfZoom } from './PdfReader'
import type { Anchor } from './useVirtualList'
import { useChrome } from './useChrome'
import { useLineWidth } from './lineWidth'
import { SpeechReader, speechSupported, type SpeechPos } from './speech'
import { SpeechBar } from './SpeechBar'
import { useSearch } from './useSearch'
import { Toolbar } from './Toolbar'
import { SettingsPanel } from './panels/SettingsPanel'
import { TocPanel } from './panels/TocPanel'
import { currentTocIndex, useSortedToc } from './toc'
import { SearchPanel } from './panels/SearchPanel'
import { ShortcutsDialog } from './panels/ShortcutsDialog'
import { useFullscreen } from '../hooks/useFullscreen'
import { Button, IconButton, Segmented } from '../components/ui'
import { cx } from '../utils/cx'
import { Icon } from '../components/Icon'
import { formatNumber, isEditableTarget } from '../utils/format'
import type { Book, ReadingProgress, ThemeName, TocEntry, ViewMode } from '../types'

type Panel = 'settings' | 'toc' | 'search' | null
const THEME_CYCLE: ThemeName[] = ['light', 'sepia', 'dark', 'comfort']

export function ReaderScreen({ bookId }: { bookId: string }) {
  const [book, setBook] = useState<Book | null | undefined>(undefined)
  const [initial, setInitial] = useState<{ anchor: Anchor | null; mode: ViewMode; zoom: PdfZoom } | null>(null)

  useEffect(() => {
    let alive = true
    Promise.all([getBook(bookId), getProgress(bookId)]).then(([b, p]) => {
      if (!alive) return
      setBook(b ?? null)
      if (!b) return
      const mode: ViewMode = p?.viewMode ?? (b.likelyScanned ? 'pdf' : 'text')
      setInitial({ anchor: p ? { index: Math.max(0, p.page - 1), frac: p.pageOffset } : null, mode, zoom: p?.pdfZoom ?? 'fit' })
      updateBook(bookId, { lastOpenedAt: Date.now() }).catch(() => undefined)
    })
    return () => {
      alive = false
    }
  }, [bookId])

  if (book === null)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 text-ink-soft">
        <p>This book isn’t in your library anymore.</p>
        <Button onClick={() => navigate({ name: 'library' })}>Back to library</Button>
      </div>
    )
  if (!book || !initial) return <div className="h-full" />
  return <Reader book={book} setBook={setBook} initial={initial} />
}

function Reader({ book, setBook, initial }: { book: Book; setBook: (b: Book) => void; initial: { anchor: Anchor | null; mode: ViewMode; zoom: PdfZoom } }) {
  const settings = useSettings()
  const [controller] = useState(() => new ScrollController())
  const [positions] = useState(() => new PositionStore())
  const readerRef = useRef<ReaderHandle>(null)
  const auto = useAutoScrollState(controller)
  const fs = useFullscreen()
  const job = useExtractionJob(book.id)
  const search = useSearch(book.id)
  const toc = useSortedToc(book)
  const lineWidth = useLineWidth()

  // ---- read aloud (a separate feature from auto-scroll; switched on/off in settings or the toolbar) ----
  const [speech] = useState(() => new SpeechReader(book.id, book.pageCount))
  const speechStatus = useSyncExternalStore(speech.subscribe, () => speech.getSnapshot().status)
  const speechPage = useSyncExternalStore(speech.subscribe, () => speech.getSnapshot().page)
  const [follow, setFollow] = useState(true)
  const [readHere, setReadHere] = useState<{ pos: SpeechPos; x: number; y: number } | null>(null)
  /** Auto-scroll was running when the voice took over → continue it when the voice stops. */
  const resumeAutoAfterSpeech = useRef(false)

  const [viewMode, setViewMode] = useState<ViewMode>(initial.mode)
  const [viewAnchor, setViewAnchor] = useState<Anchor | null>(initial.anchor)
  const [zoom, setZoom] = useState<PdfZoom>(initial.zoom)
  const [effectiveScale, setEffectiveScale] = useState(1)
  const [panel, setPanel] = useState<Panel>(null)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [hud, setHud] = useState<{ text: string; id: number } | null>(null)

  const chrome = useChrome({ fullscreen: fs.isFullscreen, autoScrolling: auto.state === 'running', pinned: panel !== null || showShortcuts || readHere !== null })

  useEffect(() => {
    controller.setSpeed(settings.autoScrollSpeed)
  }, [controller, settings.autoScrollSpeed])

  useEffect(() => () => controller.dispose(), [controller])

  const flash = useCallback((text: string) => setHud({ text, id: Date.now() }), [])
  useEffect(() => {
    if (!hud) return
    const t = setTimeout(() => setHud(null), 1100)
    return () => clearTimeout(t)
  }, [hud])

  // ---- live extraction: refresh book stats as pages arrive ----
  const running = job?.status === 'running' || job?.status === 'cancelling'
  const processedLive = job?.progress?.processed ?? 0
  const ocrLive = running && job?.progress?.phase === 'ocr' ? job.progress.ocr : undefined
  /** Changes whenever new text is available (extracted pages or OCR-recognized pages). */
  const liveTick = processedLive + (ocrLive?.done ?? 0)
  useEffect(() => {
    if (!job) return
    const t = setTimeout(() => getBook(book.id).then((b) => b && setBook(b)), running ? 1200 : 0)
    return () => clearTimeout(t)
  }, [liveTick, running, job, book.id, setBook])

  // ---- position & progress ----
  const cumChars = useMemo(() => {
    const arr = new Float64Array(book.pageCount + 1)
    for (let i = 0; i < book.pageCount; i++) arr[i + 1] = arr[i] + (book.pageChars[i] ?? 0)
    return arr
  }, [book.pageChars, book.pageCount])

  // Latest values for event handlers / timers that shouldn't re-subscribe on every change.
  const viewModeRef = useRef(viewMode)
  const zoomRef = useRef(zoom)
  const effectiveScaleRef = useRef(effectiveScale)
  useLayoutEffect(() => {
    viewModeRef.current = viewMode
    zoomRef.current = zoom
    effectiveScaleRef.current = effectiveScale
  }, [viewMode, zoom, effectiveScale])

  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastAnchor = useRef<Anchor | null>(initial.anchor)

  const saveNow = useCallback(() => {
    const a = lastAnchor.current
    if (!a) return
    const pos = positions.get()
    const record: ReadingProgress = {
      bookId: book.id,
      page: a.index + 1,
      pageOffset: a.frac,
      scrollPosition: controller.top,
      percentage: pos.percent,
      viewMode: viewModeRef.current,
      pdfZoom: typeof zoomRef.current === 'number' ? zoomRef.current : undefined,
      updatedAt: Date.now(),
    }
    putProgress(record).catch(() => undefined)
  }, [book.id, controller, positions])

  const onPosition = useCallback(
    (top: Anchor, a: Anchor) => {
      lastAnchor.current = top
      const el = controller.el
      const atEnd = !!el && el.scrollTop + el.clientHeight >= el.scrollHeight - 2 && el.scrollHeight > el.clientHeight
      let percent: number
      if (viewModeRef.current === 'text' && cumChars[book.pageCount] > 0) {
        percent = ((cumChars[a.index] + a.frac * (cumChars[a.index + 1] - cumChars[a.index])) / cumChars[book.pageCount]) * 100
      } else {
        percent = ((a.index + a.frac) / Math.max(1, book.pageCount)) * 100
      }
      if (atEnd) percent = 100
      positions.set({ page: a.index + 1, frac: a.frac, percent: Math.min(100, Math.max(0, percent)) })
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(saveNow, 800)
    },
    [book.pageCount, controller, cumChars, positions, saveNow],
  )

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') saveNow()
    }
    window.addEventListener('pagehide', saveNow)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', saveNow)
      document.removeEventListener('visibilitychange', onHide)
      clearTimeout(saveTimer.current)
      saveNow()
    }
  }, [saveNow])

  // Save when switching view mode / zoom.
  useEffect(() => {
    saveNow()
  }, [viewMode, zoom, saveNow])

  // ---- navigation helpers ----
  const switchView = useCallback(
    (mode: ViewMode) => {
      if (mode === viewModeRef.current) return
      controller.stop()
      const a = readerRef.current?.getAnchor() ?? lastAnchor.current
      setViewAnchor(a ? { ...a } : null)
      setViewMode(mode)
    },
    [controller],
  )

  const recognizeText = useCallback(() => {
    flash('Recognizing text in image pages…')
    extraction.runOcr(book.id)
  }, [book.id, flash])

  const openPdfAt = useCallback(
    (page: number) => {
      controller.stop()
      setViewAnchor({ index: page - 1, frac: 0 })
      setViewMode('pdf')
    },
    [controller],
  )

  const jumpToPage = useCallback(
    (page: number) => {
      controller.pause('user')
      readerRef.current?.jumpTo(Math.min(book.pageCount, Math.max(1, page)), 0)
    },
    [book.pageCount, controller],
  )

  const jumpToToc = useCallback(
    (e: TocEntry) => {
      controller.pause('user')
      if (e.block !== undefined && viewModeRef.current === 'text') readerRef.current?.jumpToBlock(e.page, e.block)
      else readerRef.current?.jumpTo(e.page, 0)
      if (window.innerWidth < 900) setPanel(null)
    },
    [controller],
  )

  // Search: jump to the active hit whenever it changes.
  const activeHit = search.index >= 0 ? search.hits[search.index] : undefined
  const activeMatch: ActiveMatch | null = useMemo(() => (activeHit ? { page: activeHit.page, block: activeHit.block, start: activeHit.start } : null), [activeHit])
  useEffect(() => {
    if (!activeMatch) return
    controller.pause('user')
    if (viewModeRef.current === 'text') readerRef.current?.jumpToBlock(activeMatch.page, activeMatch.block, true)
    else readerRef.current?.jumpTo(activeMatch.page, 0)
  }, [activeMatch, controller])

  const startReading = useCallback(() => {
    if (auto.state === 'running') return
    controller.start()
  }, [auto.state, controller])

  // ---- read aloud wiring ----
  useEffect(() => () => speech.dispose(), [speech])
  useEffect(() => {
    speech.configure({ voiceURI: settings.speechVoice, rate: settings.speechRate })
  }, [speech, settings.speechVoice, settings.speechRate])
  useEffect(() => {
    if (running) speech.invalidateMissing()
  }, [liveTick, running, speech])
  // Scrolling by hand while listening: stop following (a "Follow" button brings it back).
  useEffect(
    () =>
      controller.onUserScroll(() => {
        if (speech.active) setFollow(false)
        setReadHere(null)
      }),
    [controller, speech],
  )
  // Only one thing drives the page at a time: starting auto-scroll pauses the voice.
  useEffect(() => {
    if (auto.state === 'running' && (speech.status === 'playing' || speech.status === 'loading')) {
      resumeAutoAfterSpeech.current = false
      speech.pause()
    }
  }, [auto.state, speech])
  // Voice stopped / switched off → continue auto-scroll if it was running before.
  const prevSpeechStatus = useRef(speechStatus)
  useEffect(() => {
    const prev = prevSpeechStatus.current
    prevSpeechStatus.current = speechStatus
    if (speechStatus === 'idle' && prev !== 'idle' && resumeAutoAfterSpeech.current) {
      resumeAutoAfterSpeech.current = false
      controller.start()
    }
  }, [speechStatus, controller])
  // PDF view has no word highlighting: follow by turning pages.
  useEffect(() => {
    if (viewModeRef.current === 'pdf' && follow && speechStatus === 'playing') readerRef.current?.jumpTo(speechPage, 0)
  }, [speechPage, follow, speechStatus])
  useEffect(() => {
    if (!readHere) return
    const t = setTimeout(() => setReadHere(null), 6000)
    return () => clearTimeout(t)
  }, [readHere])

  const takeOverFromAutoScroll = useCallback(() => {
    if (controller.state === 'running') {
      resumeAutoAfterSpeech.current = true
      controller.pause('user')
    }
  }, [controller])

  const startSpeech = useCallback(
    (pos?: SpeechPos) => {
      if (!speechSupported) {
        flash('Read aloud isn’t supported in this browser')
        return
      }
      if (!getSettings().readAloud) updateSettings({ readAloud: true })
      takeOverFromAutoScroll()
      setFollow(true)
      setReadHere(null)
      speech.start(pos ?? readerRef.current?.getReadingStart() ?? { page: positions.get().page, block: 0, offset: 0 })
    },
    [speech, positions, flash, takeOverFromAutoScroll],
  )

  const toggleSpeech = useCallback(() => {
    const st = speech.status
    if (st === 'playing' || st === 'loading') speech.pause()
    else if (st === 'paused') {
      takeOverFromAutoScroll()
      setFollow(true)
      speech.resume()
    } else startSpeech()
  }, [speech, startSpeech, takeOverFromAutoScroll])

  const setReadAloud = useCallback(
    (on: boolean) => {
      updateSettings({ readAloud: on })
      if (on) flash('Read aloud on · press L or click a word')
      else {
        setReadHere(null)
        speech.stop() // → auto-scroll continues if the voice had taken over from it
      }
    },
    [speech, flash],
  )

  const onWordClick = useCallback(
    (pos: SpeechPos, x: number, y: number) => {
      if (speech.active) {
        // Already listening: jump straight to the clicked word.
        takeOverFromAutoScroll()
        setFollow(true)
        speech.start(pos)
      } else setReadHere({ pos, x, y })
    },
    [speech, takeOverFromAutoScroll],
  )

  // ---- keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const key = e.key
      // Cmd/Ctrl+F: browser find can't see virtualised text, so open the book search instead.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && key.toLowerCase() === 'f') {
        e.preventDefault()
        setPanel('search')
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isEditableTarget(e.target)) {
        if (key === 'Escape') (e.target as HTMLElement).blur()
        return
      }
      const target = e.target as HTMLElement
      const onRange = target instanceof HTMLInputElement && target.type === 'range'
      const el = controller.el
      const lineStep = viewModeRef.current === 'text' ? getSettings().fontSize * getSettings().lineHeight * 3 : 120

      switch (key) {
        case ' ':
        case 'Spacebar':
          e.preventDefault()
          controller.toggle()
          break
        case 'r':
        case 'R':
          startReading()
          break
        case 'ArrowDown':
        case 'ArrowUp':
          if (onRange) return
          e.preventDefault()
          controller.pause('manual')
          el?.scrollBy({ top: key === 'ArrowDown' ? lineStep : -lineStep, behavior: 'smooth' })
          break
        case 'PageDown':
        case 'PageUp':
          if (target === el) return // native behaviour when the scroller has focus
          e.preventDefault()
          controller.pause('manual')
          el?.scrollBy({ top: (key === 'PageDown' ? 1 : -1) * (el.clientHeight * 0.88), behavior: 'smooth' })
          break
        case 'Home':
          e.preventDefault()
          controller.pause('manual')
          readerRef.current?.jumpTo(1, 0)
          break
        case 'End':
          e.preventDefault()
          controller.pause('manual')
          readerRef.current?.jumpTo(book.pageCount, 0.999)
          break
        case 'ArrowRight':
        case 'ArrowLeft':
        case ']':
        case '[': {
          if (onRange) return
          e.preventDefault()
          const dir = key === 'ArrowRight' || key === ']' ? 1 : -1
          const next = stepSpeed(getSettings().autoScrollSpeed, dir)
          updateSettings({ autoScrollSpeed: next })
          flash(`Speed · ${speedLabel(next)} · ${next} px/s`)
          break
        }
        case '+':
        case '=':
        case '-':
        case '_': {
          e.preventDefault()
          const dir = key === '+' || key === '=' ? 1 : -1
          if (viewModeRef.current === 'text') {
            const size = Math.min(LIMITS.fontSize.max, Math.max(LIMITS.fontSize.min, getSettings().fontSize + dir))
            updateSettings({ fontSize: size })
            flash(`Font size · ${size}px`)
          } else {
            setZoom((z) => {
              const cur = typeof z === 'number' ? z : effectiveScaleRef.current
              const next = Math.min(4, Math.max(0.25, +(dir > 0 ? cur * 1.2 : cur / 1.2).toFixed(2)))
              flash(`Zoom · ${Math.round(next * 100)}%`)
              return next
            })
          }
          break
        }
        case ',':
        case '<':
        case '.':
        case '>': {
          if (viewModeRef.current !== 'text') return
          e.preventDefault()
          const dir = key === '.' || key === '>' ? 1 : -1
          if (dir > 0 && lineWidth.isFull) flash('Line width · full width')
          else {
            lineWidth.step(dir)
            const next = Math.max(5, lineWidth.words + dir)
            flash(next >= lineWidth.maxWords ? 'Line width · full width' : `Line width · ${next} words per line`)
          }
          break
        }
        case 'f':
        case 'F':
          e.preventDefault()
          fs.toggle()
          break
        case 'l':
        case 'L':
          e.preventDefault()
          if (!getSettings().readAloud) startSpeech()
          else toggleSpeech()
          break
        case 'Escape':
          if (readHere) setReadHere(null)
          else if (panel) setPanel(null)
          else if (fs.isPseudo) fs.exit()
          break
        case '/':
          e.preventDefault()
          setPanel('search')
          break
        case 't':
        case 'T':
          setPanel((p) => (p === 'toc' ? null : 'toc'))
          break
        case 's':
        case 'S':
          setPanel((p) => (p === 'settings' ? null : 'settings'))
          break
        case 'm':
        case 'M':
          switchView(viewModeRef.current === 'text' ? 'pdf' : 'text')
          break
        case 'd':
        case 'D': {
          const next = THEME_CYCLE[(THEME_CYCLE.indexOf(getSettings().theme) + 1) % THEME_CYCLE.length]
          updateSettings({ theme: next })
          flash(`Theme · ${next === 'comfort' ? 'Eye comfort' : next[0].toUpperCase() + next.slice(1)}`)
          break
        }
        case '?':
          setShowShortcuts(true)
          break
        default:
          return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [controller, fs, panel, startReading, switchView, book.pageCount, flash, lineWidth, startSpeech, toggleSpeech, readHere])

  // Keep keyboard scrolling working: focus the scroller when nothing else is focused.
  useEffect(() => {
    const t = setTimeout(() => {
      if (document.activeElement === document.body) controller.el?.focus({ preventScroll: true })
    }, 50)
    return () => clearTimeout(t)
  }, [controller, viewMode])

  const onTap = useCallback(() => {
    if (window.matchMedia('(pointer: coarse)').matches) chrome.toggle()
  }, [chrome])

  const extractedPages = running ? Math.max(book.processedPages, processedLive) : book.processedPages
  const showChrome = chrome.visible

  return (
    <div className={cx('relative h-full overflow-hidden bg-paper', !showChrome && 'cursor-none')}>
      <div className="absolute inset-0">
        {viewMode === 'text' ? (
          <TextReader
            ref={readerRef}
            book={book}
            settings={settings}
            controller={controller}
            initialAnchor={viewAnchor}
            onPosition={onPosition}
            onOpenPdfAt={openPdfAt}
            onTap={onTap}
            query={search.activeQuery}
            wholeWord={search.wholeWord}
            activeMatch={activeMatch}
            extractionTick={running ? liveTick : 0}
            onRecognizeText={book.ocrAttempted ? undefined : recognizeText}
            speech={speech}
            followSpeech={follow}
            onWordClick={settings.readAloud ? onWordClick : undefined}
          />
        ) : (
          <PdfReader
            ref={readerRef}
            book={book}
            controller={controller}
            initialAnchor={viewAnchor}
            onPosition={onPosition}
            zoom={zoom}
            onEffectiveScale={setEffectiveScale}
            onTap={onTap}
          />
        )}
      </div>

      {/* ---------------- top bar ---------------- */}
      <header
        {...chrome.hoverProps}
        className={cx(
          'pointer-events-none absolute inset-x-0 top-0 z-30 transition-all duration-300',
          showChrome ? 'translate-y-0 opacity-100' : '-translate-y-3 opacity-0',
        )}
      >
        <div
          className={cx(
            'flex items-center gap-2 px-3 pb-6 pt-3 sm:px-5',
            showChrome && 'pointer-events-auto',
            'bg-gradient-to-b from-[var(--paper)] from-40% to-transparent',
          )}
        >
          <IconButton icon="arrow-left" label="Back to library" tipPos="bottom" onClick={() => navigate({ name: 'library' })} />
          <TitleBlock book={book} toc={toc} positions={positions} />
          <div className="ml-auto flex items-center gap-1">
            <GoToPage positions={positions} pageCount={book.pageCount} onGo={jumpToPage} onDone={() => controller.el?.focus({ preventScroll: true })} />
            <Segmented
              label="View mode"
              value={viewMode}
              onChange={switchView}
              className="hidden md:flex"
              options={[
                { value: 'text', label: 'Reading View', title: 'Extracted text, formatted for reading (M)' },
                { value: 'pdf', label: 'PDF View', title: 'Original PDF pages (M)' },
              ]}
            />
            <IconButton
              icon={viewMode === 'text' ? 'file' : 'file-text'}
              label={viewMode === 'text' ? 'Switch to PDF view' : 'Switch to reading view'}
              className="md:hidden"
              tipPos="bottom"
              onClick={() => switchView(viewMode === 'text' ? 'pdf' : 'text')}
            />
            <IconButton icon="search" label="Search (/)" tipPos="bottom" active={panel === 'search'} onClick={() => setPanel(panel === 'search' ? null : 'search')} />
            <IconButton icon="list" label="Contents (T)" tipPos="bottom" active={panel === 'toc'} onClick={() => setPanel(panel === 'toc' ? null : 'toc')} />
            <IconButton icon={fs.isFullscreen ? 'minimize' : 'maximize'} label={fs.isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'} tipPos="bottom" onClick={fs.toggle} className="hidden sm:inline-flex" />
          </div>
        </div>
        {running && (
          <div className={cx('pointer-events-auto mx-auto -mt-3 flex w-fit items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-[12px] text-ink-soft')}>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            {ocrLive
              ? `Recognizing text in image pages · ${formatNumber(ocrLive.done)} of ${formatNumber(ocrLive.total)}`
              : `Still extracting · ${formatNumber(extractedPages)} of ${formatNumber(book.pageCount)} pages ready`}
          </div>
        )}
      </header>

      {/* ---------------- bottom controls ---------------- */}
      <div
        {...chrome.hoverProps}
        className={cx(
          'absolute inset-x-0 bottom-0 z-30 flex flex-col items-center gap-2 bg-gradient-to-t from-[var(--paper)] from-65% to-transparent px-3 pb-5 pt-12 transition-all duration-300',
          showChrome ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0',
        )}
      >
        {settings.readAloud && (
          <SpeechBar
            speech={speech}
            follow={follow}
            onFollow={() => setFollow(true)}
            onPlay={toggleSpeech}
            onTurnOff={() => setReadAloud(false)}
            onOpenOptions={() => setPanel('settings')}
          />
        )}
        <ProgressLine positions={positions} book={book} toc={toc} viewMode={viewMode} />
        <Toolbar
          controller={controller}
          viewMode={viewMode}
          isFullscreen={fs.isFullscreen}
          onToggleFullscreen={fs.toggle}
          onOpenSettings={() => setPanel(panel === 'settings' ? null : 'settings')}
          zoom={zoom}
          effectiveScale={effectiveScale}
          onZoom={setZoom}
          readAloud={settings.readAloud}
          onToggleReadAloud={() => setReadAloud(!settings.readAloud)}
        />
      </div>

      {/* Always-visible hairline progress bar */}
      <ThinProgress positions={positions} hidden={showChrome} />

      {/* "Read aloud from here" – appears where a word was clicked */}
      {readHere && settings.readAloud && (
        <div
          className="fade-in absolute z-40"
          style={{ left: Math.max(12, Math.min(readHere.x - 100, window.innerWidth - 232)), top: Math.min(readHere.y + 16, window.innerHeight - 180) }}
        >
          <button
            type="button"
            autoFocus
            onClick={() => startSpeech(readHere.pos)}
            className="flex items-center gap-2 rounded-full bg-ink py-2 pl-3 pr-4 text-[13px] font-medium text-paper shadow-float hover:scale-[1.02]"
          >
            <Icon name="play" size={13} /> Read aloud from here
          </button>
        </div>
      )}

      {/* Paused-by-manual-scroll hint (visible even when controls are hidden) */}
      {auto.state === 'paused' && (auto.reason === 'manual' || auto.reason === 'end') && !showChrome && (
        <button
          type="button"
          onClick={() => (auto.reason === 'end' ? chrome.show() : controller.resume())}
          className="fade-in absolute bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-panel px-4 py-2 text-[13px] text-ink-soft shadow-float backdrop-blur-xl hover:text-ink"
        >
          <Icon name={auto.reason === 'end' ? 'check' : 'play'} size={14} />
          {auto.reason === 'end' ? 'Reached the end' : 'Auto-scroll paused · Resume'}
          {auto.reason !== 'end' && <span className="text-ink-faint">Space</span>}
        </button>
      )}

      {hud && (
        <div key={hud.id} role="status" className="fade-in pointer-events-none absolute left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink/85 px-4 py-2 text-[13px] font-medium text-paper">
          {hud.text}
        </div>
      )}

      <SettingsPanel open={panel === 'settings'} onClose={() => setPanel(null)} onShowShortcuts={() => setShowShortcuts(true)} onToggleReadAloud={setReadAloud} />
      <TocPanel open={panel === 'toc'} onClose={() => setPanel(null)} book={book} toc={toc} positions={positions} onJump={jumpToToc} />
      <SearchPanel open={panel === 'search'} onClose={() => setPanel(null)} search={search} extractedPages={extractedPages} pageCount={book.pageCount} />
      <ShortcutsDialog open={showShortcuts} onClose={() => setShowShortcuts(false)} />

      {book.likelyScanned && viewMode === 'text' && !ocrLive && <ScannedNotice onPdf={() => switchView('pdf')} onRecognize={book.ocrAttempted ? undefined : recognizeText} />}
    </div>
  )
}

function TitleBlock({ book, toc, positions }: { book: Book; toc: TocEntry[]; positions: PositionStore }) {
  const { page } = usePosition(positions)
  const idx = currentTocIndex(toc, page)
  return (
    <div className="min-w-0 flex-1 px-1">
      <p className="truncate font-serif text-[15px] font-semibold text-ink">{book.title}</p>
      <p className="truncate text-[12px] text-ink-faint">{idx >= 0 ? toc[idx].title : book.author || ' '}</p>
    </div>
  )
}

function GoToPage({ positions, pageCount, onGo, onDone }: { positions: PositionStore; pageCount: number; onGo: (p: number) => void; onDone: () => void }) {
  const { page } = usePosition(positions)
  const [editing, setEditing] = useState<string | null>(null)
  return (
    <form
      className="mr-1 hidden items-center gap-1 text-[13px] text-ink-soft lg:flex"
      onSubmit={(e) => {
        e.preventDefault()
        const n = parseInt(editing ?? '', 10)
        setEditing(null)
        if (Number.isFinite(n)) onGo(n)
        // Hand focus back to the book so Space / arrows control reading again.
        onDone()
      }}
    >
      <label htmlFor="goto-page">Page</label>
      <input
        id="goto-page"
        inputMode="numeric"
        value={editing ?? String(page)}
        onFocus={(e) => {
          setEditing(e.target.value)
          const input = e.target
          // select() also focuses – only do it if the input still has focus by then.
          requestAnimationFrame(() => document.activeElement === input && input.select())
        }}
        onBlur={() => setEditing(null)}
        onChange={(e) => setEditing(e.target.value.replace(/\D/g, ''))}
        className="h-8 w-14 rounded-lg border border-line bg-paper-2 text-center tabular-nums text-ink outline-none focus:border-accent"
        aria-label={`Go to page (1 to ${pageCount})`}
        title="Type a page number and press Enter"
      />
      <span className="tabular-nums">/ {formatNumber(pageCount)}</span>
    </form>
  )
}

function ProgressLine({ positions, book, toc, viewMode }: { positions: PositionStore; book: Book; toc: TocEntry[]; viewMode: ViewMode }) {
  const pos = usePosition(positions)
  const idx = currentTocIndex(toc, pos.page)
  return (
    <div className="flex w-full max-w-3xl items-center justify-between gap-4 px-2 text-[12px] text-ink-faint">
      <span className="min-w-0 truncate">
        {idx >= 0 && <span className="text-ink-soft">{toc[idx].title} · </span>}
        Page {formatNumber(pos.page)} of {formatNumber(book.pageCount)}
      </span>
      <span className="shrink-0 tabular-nums">
        {viewMode === 'text' ? `${pos.percent.toFixed(pos.percent < 10 ? 1 : 0)}% complete` : `${Math.round(pos.percent)}%`}
      </span>
    </div>
  )
}

function ThinProgress({ positions, hidden }: { positions: PositionStore; hidden: boolean }) {
  const { percent } = usePosition(positions)
  return (
    <div aria-hidden="true" className={cx('pointer-events-none absolute inset-x-0 bottom-0 z-20 h-[2px] transition-opacity duration-300', hidden ? 'opacity-0' : 'opacity-100')}>
      <div className="h-full bg-accent/60" style={{ width: `${percent}%` }} />
    </div>
  )
}

function ScannedNotice({ onPdf, onRecognize }: { onPdf: () => void; onRecognize?: () => void }) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null
  return (
    <div role="status" className="fade-in absolute left-1/2 top-20 z-30 flex w-[min(560px,calc(100vw-24px))] -translate-x-1/2 items-start gap-3 rounded-2xl border border-line bg-panel p-4 text-[13px] leading-relaxed text-ink-soft shadow-float backdrop-blur-xl">
      <Icon name="info" size={18} className="mt-0.5 shrink-0 text-accent" />
      <p className="flex-1">
        {onRecognize
          ? 'Most pages in this PDF have their text as pictures (a scan, or a designed/presentation export). Folio can read them with on-device text recognition, or you can use the PDF view.'
          : 'Most pages in this PDF are pictures without readable text. The PDF view shows them exactly as designed.'}
      </p>
      <div className="flex shrink-0 flex-col gap-1.5">
        {onRecognize && (
          <Button size="sm" variant="primary" onClick={() => (setDismissed(true), onRecognize())}>
            Recognize text
          </Button>
        )}
        <Button size="sm" variant={onRecognize ? 'secondary' : 'primary'} onClick={onPdf}>
          PDF view
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
          Dismiss
        </Button>
      </div>
    </div>
  )
}
