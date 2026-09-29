/** Block types produced by the layout analyser. */
export type BlockType = 'h1' | 'h2' | 'h3' | 'p'

/** A single formatted block of extracted text (a heading or a paragraph). */
export interface Block {
  t: BlockType
  x: string
}

export type ExtractionStatus = 'pending' | 'extracting' | 'complete' | 'partial' | 'cancelled' | 'error'

export type PageStatus = 'ok' | 'empty' | 'error'

export interface TocEntry {
  title: string
  /** 1-based page number. */
  page: number
  level: number
  /** Index of the heading block inside the page, when the entry was detected from text. */
  block?: number
}

export interface Book {
  id: string
  filename: string
  title: string
  author?: string
  pageCount: number
  fileSize: number
  fileLastModified: number
  createdAt: number
  lastOpenedAt: number
  extractionStatus: ExtractionStatus
  /** Number of pages that have been processed (successfully or not). */
  processedPages: number
  /** 0..1 */
  extractionProgress: number
  totalCharacters: number
  /** Characters per page (index = page - 1). Used for progress + layout estimates. */
  pageChars: number[]
  /** Block count per page (index = page - 1). */
  pageBlocks: number[]
  emptyPages: number[]
  failedPages: number[]
  toc: TocEntry[]
  tocSource: 'outline' | 'detected' | 'none'
  likelyScanned: boolean
  extractionError?: string
  /** Small JPEG thumbnail of page 1, used as the cover on the library screen. */
  cover?: Blob
  extractionMs?: number
  /** Pages whose text was recognised with OCR. */
  ocrPages?: number
  /** Text recognition has been run on this book's image pages. */
  ocrAttempted?: boolean
}

export interface PageRecord {
  bookId: string
  /** 1-based page number. */
  page: number
  blocks: Block[]
  chars: number
  status: PageStatus
  error?: string
  /** Normalised text of the first/last line, used to detect running headers/footers. */
  hfTop?: string
  hfBottom?: string
  /** Text was recognised from the page image (OCR). */
  ocr?: boolean
}

export type ThemeName = 'light' | 'sepia' | 'dark' | 'comfort'

export type ViewMode = 'text' | 'pdf'

export interface ReadingSettings {
  fontFamily: string
  fontSize: number
  lineHeight: number
  paragraphSpacing: number
  /** Maximum text column width in px. */
  readingWidth: number
  textAlign: 'left' | 'justify'
  theme: ThemeName
  ambientEnabled: boolean
  /** 0..100 warmth of the ambient light overlay. */
  ambientWarmth: number
  /** 0..100 how much the ambient light dims the screen. */
  ambientDim: number
  /** Auto-scroll speed in CSS px per second. */
  autoScrollSpeed: number
  showPageMarkers: boolean
  /** Read-aloud feature switched on (separate from auto-scroll). */
  readAloud: boolean
  /** voiceURI of the read-aloud voice ('' = automatic) */
  speechVoice: string
  /** read-aloud speed, 0.5 – 2 (1 = normal) */
  speechRate: number
}

export interface ReadingProgress {
  bookId: string
  /** 1-based page number at the top of the viewport. */
  page: number
  /** 0..1 fraction of the way through that page. */
  pageOffset: number
  /** Scroll position (px) at the time of saving; informational only since layout depends on settings. */
  scrollPosition: number
  /** 0..100 */
  percentage: number
  viewMode: ViewMode
  pdfZoom?: number
  updatedAt: number
}
