# Folio — PDF Book Reader

A local, browser-based reading environment for PDF books. Folio extracts the text of a PDF (including very large books with 1,000+ pages), turns it into a clean, typographically formatted reading view, and provides smooth teleprompter-style auto-scrolling.

Everything runs locally in your browser. No server is involved and nothing leaves your device.

## Run it locally

Requirements: Node.js 22+ (tested with Node 24) and a modern browser (Chrome, Edge, Firefox or Safari).

```bash
npm install
npm run dev          # → http://localhost:5173
```

Production build:

```bash
npm run build        # type-check + bundle into dist/
npm run preview      # serve the built app locally
```

`dist/` is a static site, so it can also be served by any static file server.

## Features

| Area | What you get |
| --- | --- |
| Library | Recent books with cover, page count, reading progress, last-read time and a **Continue Reading** card. Books reopen instantly without being extracted again. |
| Upload | Drag and drop anywhere on the page, or **Choose PDF**. Shows the title, author, file name, size, page count and whether bookmarks exist before you press **Extract & Read**. Password-protected PDFs prompt for the password. |
| Extraction | Runs in a Web Worker, page by page, with real progress ("Extracting page 324 of 1,247"), pages/second, time remaining, and counts of empty and failed pages. It can be cancelled, keeps already-extracted pages, and resumes where it stopped. |
| Reading View | Paragraphs, detected headings, optional page markers, and a centred column. Running headers and footers and bare page numbers are removed, and hyphenated words are rejoined. |
| PDF View | The original pages rendered on canvas, with zoom (fit width, or 25–400%), page jump and current page / total. |
| Typography | 10 bundled fonts (Literata, Georgia, Merriweather, Lora, Source Serif, Inter, Open Sans, Roboto, system serif, system sans), font size (slider and −/+), line spacing, paragraph spacing, **line width in words per line** (toolbar button, −/+, slider, presets Narrow / Comfortable / Wide / Extra wide / Full width), and left or justified alignment. Changes apply instantly. |
| Themes | Light (warm off-white), Sepia, Dark (near-black) and Eye Comfort (warm, dim, lower contrast). **Ambient light** adds an adjustable warm tint and dimming over the whole app. It is a comfort feature only, not a medical one. |
| Auto-scroll | Start / pause / resume / stop, and a perceptual speed slider (Very slow → Very fast, 4–240 px/s) with −/+ and presets. Speed changes live while scrolling. Manually scrolling pauses it, and a visible **Resume** button appears. |
| Read aloud | A **separate, switchable feature** (🔊 in the toolbar, **L**, or Settings → Read aloud). It speaks the book with your device's own voices, fully offline via the browser's Web Speech API. The current sentence and word are highlighted and the page follows along. **Click any word → "Read aloud from here"**; while it's speaking, clicking a word jumps there. It has previous/next sentence, pause/resume, stop, voice choice and speed (0.5–2×), and continues across the whole book. Turn it off and everything behaves exactly as before. |
| Image-only pages (OCR) | Presentations, designed exports and scans often store text as pictures. Folio recognizes it automatically after extraction, with on-device OCR (Tesseract WebAssembly plus English data served from the app, so it works offline). Slide titles and body text become headings and paragraphs, and repeated slide labels are removed. You can also start it from the reader with **Recognize text**. |
| Fullscreen | Distraction-free mode: controls hide, and reappear when the pointer nears the top or bottom edge. Esc exits. Browsers without element fullscreen fall back to a focus mode. |
| Search | Full-book search in a worker, with match count, previous/next, highlighted results with snippets, and jump to any result. |
| Contents | Uses the PDF's bookmarks when present; otherwise builds a table of contents from detected headings. Shows the current chapter. |
| Progress | "Chapter 4 · Page 184 of 1,247 · 42% complete". The percentage in Reading View is character-based; in PDF View it is page-based. |
| Persistence | Reading position (page and offset), view mode, zoom and all reading settings are restored on reopen. |

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Start / pause auto-scroll |
| R | Start or resume reading |
| L | Read aloud: play / pause (turns it on) |
| → / ] and ← / [ | Faster / slower auto-scroll |
| ↑ / ↓, PgUp / PgDn | Manual scrolling (pauses auto-scroll) |
| + / − | Font size (zoom in PDF View) |
| , / . | Fewer / more words per line |
| F | Fullscreen |
| Esc | Close panel / exit fullscreen |
| / or Ctrl/⌘ + F | Search the book |
| T / S | Contents / Settings |
| M | Switch Reading ↔ PDF View |
| D | Cycle theme |
| Home / End | Beginning / end |
| ? | Shortcut help |

Shortcuts are ignored while typing in a text field, and never fire together with Ctrl, ⌘ or Alt. The exception is Ctrl/⌘+F: the Reading View is virtualised, so the browser's own find can't see text that isn't on screen, and it is redirected to the book search.

## Technology

- **React 19 + TypeScript**, built with **Vite 8**
- **Tailwind CSS 4**, with theme tokens as CSS variables
- **PDF.js 6** (`pdfjs-dist`) for parsing, text extraction and rendering
- **Web Workers** for extraction and search
- **IndexedDB** (via `idb`) for books, pages and progress; **localStorage** for reading settings
- Fonts bundled locally with **@fontsource**, so the app works offline

```
src/
  App.tsx, router.ts          hash router: #/ · #/processing/:id · #/read/:id
  types.ts                    Book, PageRecord, Block, ReadingSettings, ReadingProgress
  storage/   db.ts            IndexedDB schema + queries
             settings.ts      reading settings store (localStorage), fonts, speed scale
  pdf/       pdfjs.ts         PDF.js setup (UI thread)
             inspect.ts       metadata / page count / cover before extraction
             errors.ts        technical errors → plain-language messages
  extraction/textLayout.ts    text runs → lines → paragraphs/headings (pure, testable)
             outline.ts       PDF bookmarks → table of contents
             manager.ts       UI-side controller for the extraction worker
             protocol.ts      worker message types
             ocr.ts           OCR extension point (not implemented, see below)
  workers/   extract.worker.ts   progressive extraction
             search.worker.ts    streaming full-text search
  reader/    ReaderScreen.tsx    reader shell, shortcuts, progress, persistence
             TextReader.tsx      virtualised Reading View
             PdfReader.tsx       virtualised PDF View
             useVirtualList.ts   variable-height virtualisation + scroll anchoring
             scrollController.ts auto-scroll engine
             pageStore.ts        on-demand page cache (LRU)
             panels/             settings, contents, search, shortcuts
  library/, upload/, processing/, components/, hooks/, utils/
```

## How PDF extraction works

1. **Inspect** (UI thread): PDF.js opens the file just long enough to read the page count, title and author, and to render a small cover. The document is then destroyed so its memory is freed.
2. **Import**: the original PDF blob is stored in IndexedDB. This lets PDF View, re-extraction and resuming work without re-uploading.
3. **Extract** (Web Worker): the worker runs PDF.js *inside itself* (PDF.js "fake worker" mode), so no parsing touches the UI thread. For each page it runs `getTextContent()` and passes the result through the layout analyser:
   - text runs are grouped into lines by baseline;
   - bare page numbers at the top or bottom are dropped, and first/last lines are recorded as candidate running headers or footers;
   - lines are merged into paragraphs using line-gap, indentation, short-line and font-size-change heuristics, with de-hyphenation across line breaks and drop caps merged back in;
   - blocks are classified as headings (`h1`–`h3`) by font size relative to the book's body size (tracked as a running, character-weighted histogram) and by common patterns ("Chapter", "Part", "Prologue", …).
4. Each page becomes a `PageRecord { bookId, page, blocks, chars, status }`. Records are written to IndexedDB in batches of 16, and the book record (progress, per-page character counts) is updated every 1.5 s.
5. **Finalise**: a second streaming pass removes running headers and footers that repeat on at least 15% of pages (large chapter headings are never removed), and builds a table of contents from headings when the PDF has no bookmarks.

**Robustness:**

- A failure on one page marks only that page as failed; extraction continues and failed pages are listed.
- Pages with fewer than 16 characters are marked *empty* (usually scanned images). If more than 60% of pages are empty, the book is flagged as a likely scanned PDF, and the reader explains this and offers PDF View.
- Cancelling keeps every processed page, and resuming continues from the next page.
- Invalid, corrupted, non-PDF, password-protected, oversized and out-of-storage cases each show a plain-language message. Technical detail is only available behind a "Technical details" disclosure.

## How large PDFs are handled

- **Nothing loads the whole book into memory or the DOM.** Extraction streams page by page, and each page's text is released after it is stored. The only per-book data held in memory is two small arrays: characters and blocks per page.
- PDF.js caches are cleared every 64 pages (`pdf.cleanup()`), and the worker is terminated when the job ends.
- **Reading View** is virtualised: only the pages within about 1,600 px of the viewport are rendered, and pages are fetched from IndexedDB on demand into a bounded LRU cache of 160 pages. Heights of unseen pages are estimated from their character counts and self-calibrate against measured pages. Scroll anchoring keeps the reading position stable when real heights replace estimates or when fonts and sizes change. Changing typography only updates CSS variables; no pages are re-rendered and the PDF is never reloaded.
- **PDF View** is virtualised the same way. Only nearby pages get a canvas, canvases are freed when they scroll away, and each canvas is capped at about 16.7 MP.
- **Search** streams pages from IndexedDB with a cursor in a worker, and results arrive in batches while it runs.

**Measured** on the generated 1,500-page test book (Chrome, Apple Silicon):

- extraction took about 2.3 s, with the UI steady at 61 fps throughout;
- the Reading View keeps only 2–4 pages (about 450 DOM nodes) rendered;
- a search for a common word across all 1,500 pages returns 4,909 matches in about 110 ms, plus the 250 ms debounce.

## How auto-scroll works

`ScrollController` (`src/reader/scrollController.ts`) runs a `requestAnimationFrame` loop:

- It keeps a floating-point position and advances it by `speed × Δt` each frame. Δt is clamped, so a background tab or a long frame never causes a jump.
- The integer part goes to `scrollTop`. The fractional remainder is applied as a sub-pixel `translate3d` on the content, so even 4 px/s moves continuously instead of stepping one pixel at a time. The measured maximum per-frame step at the default 36 px/s is 0.6 px.
- Speed ramps in with a smoothstep curve over about 0.65 s when starting or resuming, and changes apply live.
- Wheel, touch, scroll keys, scrollbar drags, or any scroll position the controller didn't write itself pause auto-scroll with reason *manual*, and a **Resume** pill appears. Programmatic scroll changes (jumps, virtual-list anchoring) go through the controller, so they aren't mistaken for user input.
- At the end of the book it stops with "Reached the end".

## How read aloud works

`SpeechReader` (`src/reader/speech.ts`) uses `speechSynthesis`:

- It reads the extracted text from IndexedDB, not the screen, so it continues past the rendered pages to the end of the book.
- Text is spoken one sentence at a time (`Intl.Segmenter`), and long sentences are split at commas. This avoids Chrome cutting off long utterances and gives exact positions for highlighting and skipping.
- Word highlighting comes from the voice's `boundary` events. Local voices report word boundaries; some online voices only allow sentence highlighting.
- Pause remembers the current word and resume restarts from it. This is more reliable across browsers than `speechSynthesis.pause()`.
- "Automatic" picks a natural local voice in your language and skips macOS novelty voices.
- Hand-off with auto-scroll: only one of the two drives the page at a time. Starting the voice pauses auto-scroll, and starting auto-scroll pauses the voice. Stopping the voice or switching it off resumes auto-scroll if it was running before. Scrolling by hand while listening stops following, and a **Follow** button brings it back.

## How data is stored

| Store | Where | Contents |
| --- | --- | --- |
| `books` | IndexedDB | id, filename, title, author, pageCount, fileSize, createdAt, lastOpenedAt, extractionStatus, processedPages, extractionProgress, totalCharacters, per-page char/block counts, empty/failed pages, toc, cover |
| `pages` | IndexedDB | `[bookId, page]` → blocks (`{t: 'h1'\|'h2'\|'h3'\|'p', x: text}`), chars, status (`ok`/`empty`/`error`), error |
| `files` | IndexedDB | the original PDF blob |
| `progress` | IndexedDB | bookId, page, pageOffset, scrollPosition, percentage, viewMode, pdfZoom, updatedAt |
| `folio.settings.v1` | localStorage | fontFamily, fontSize, lineHeight, paragraphSpacing, readingWidth (px; shown as words per line, measured from the book's own text in the current font), readAloud, speechVoice, speechRate, textAlign, theme, ambient settings, autoScrollSpeed, showPageMarkers |

The reading position is stored as *page + fraction of page* rather than as a pixel offset, so it survives font, width and view-mode changes. The app requests persistent storage so the browser is less likely to evict books. PDF passwords are only kept in memory for the current session and are never stored.

## Testing

```bash
npm run typecheck && npm run lint
npm run fixtures     # generates test PDFs in tests/fixtures (1,500-page novel, bookmarked handbook, scanned, corrupt, non-PDF)
npm run dev -- --port 5199
npm run test:e2e     # drives your installed Google Chrome via playwright-core
npm run test:tts     # read-aloud checks (simulated speech engine; expects the app on :5173 or BASE_URL)
```

The end-to-end suite (`tests/e2e.mjs`) covers 26 scenarios: invalid, corrupt and password-protected files; the 1,500-page extraction with a frame-rate check during extraction; formatting and header removal; virtualisation; auto-scroll smoothness, speed and manual-pause; go-to-page; font size with position retention; all themes; the settings panel and ambient light; search; the detected and bookmark tables of contents; persistence across reload; PDF View and zoom; fullscreen; keyboard help; the library; scanned-PDF detection; cancel and resume; and tablet and phone layouts. Screenshots are written to `tests/screenshots/`. The suite passes against both the dev server and the production build (`BASE_URL=http://localhost:4173 npm run test:e2e` after `npm run preview`).

The password-protected fixture (`tests/fixtures/locked.pdf`) is optional: pdf-lib can't encrypt, so it was generated with `pypdf` (`writer.encrypt('secret', algorithm='RC4-128')`). The test is skipped if the file is missing.

## Devices and browsers

- The app uses the **legacy build of PDF.js**. The modern build calls very new JavaScript features directly (`Map.prototype.getOrInsertComputed`, `Math.sumPrecise`), so PDFs failed to open on most phones and older browsers. The legacy build ships fallbacks.
- It works without `crypto.randomUUID` (missing on non-HTTPS origins), respects iPhone safe areas (notch and home indicator), uses the real visible height (`100dvh`), and avoids iOS zoom-on-focus. Touch targets are at least 44 px.
- Tested in Chrome desktop and in iPhone emulation with those newer APIs removed.
- `localhost` only works on the computer running the dev server. On a phone, use the deployed (Vercel) address.

## Design principles

The reading screen follows well-known design principles:

- **Few choices at once** (Hick's law): the toolbar is Play, Speed, **Aa**, Read aloud and More.
- **Progressive disclosure:** everyday display options live in the **Aa** panel (theme, text size, font, words per line, warm light); everything else is under More.
- **Big, forgiving targets** (Fitts's law): at least 44 px on touch screens.
- **Recognition over recall:** a one-time welcome tip, labelled steppers ("11 words per line", "Normal · 36 px/s") and tooltips.
- **Calm by default:** controls fade while reading and return when needed.

## Limitations

- **OCR is English-only** and takes about 1–2 s per image page on a laptop, longer on phones. Handwriting and very stylised fonts may not be recognized; those pages stay viewable in PDF View.
- **Layout heuristics.** Multi-column layouts, tables, footnotes, poetry and code blocks are flattened into paragraphs in reading order. Heading detection relies on font size and common patterns, so unusual typography may produce too many or too few headings.
- **Memory.** PDF.js needs the whole PDF file in memory while extracting or showing PDF View. Files above about 1.8 GB are rejected, and very large files on low-memory devices can still hit browser limits. The extracted text itself is never fully loaded.
- **Very long scroll heights.** Browsers cap element height (about 33 M px in Chrome, about 17 M px in Firefox). A book of about 5,000 pages at a very large font size and narrow width could approach this cap.
- **Read aloud** depends on the voices installed on the device. The quality and word highlighting of online (network) voices vary by browser. Headless test runs use a simulated speech engine, because headless browsers can't produce audio.
- **Search** is case-insensitive substring or whole-word matching. It doesn't fold diacritics or support fuzzy or regex search.
- Rotated or vertical text and right-to-left scripts are extracted in PDF.js's order without special layout handling.

## Recommended future improvements

1. Optional OCR (tesseract.js) for empty pages, with a language picker.
2. A PDF View text layer, for selecting and copying text on the original pages.
3. Multi-column detection by clustering line x-positions per page.
4. Bookmarks, highlights and notes stored per book in IndexedDB.
5. Reading statistics: minutes read, pages per session and estimated time left.
6. PWA support (service worker + manifest) for installation and fully offline use.
7. EPUB and plain-text import, reusing the same reader.
8. Scale the virtual scroll coordinate space for extremely long books, to stay under browser height limits.
