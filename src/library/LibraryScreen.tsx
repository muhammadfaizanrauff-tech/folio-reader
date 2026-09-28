import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { useLibrary } from './useLibrary'
import { BookCard, Cover } from './BookCard'
import { UploadView } from '../upload/UploadView'
import { extraction, useExtractionJobs } from '../extraction/manager'
import { deleteBook, estimateStorage } from '../storage/db'
import { navigate } from '../router'
import { updateSettings, useSettings } from '../storage/settings'
import { Button, IconButton, ProgressBar } from '../components/ui'
import { cx } from '../utils/cx'
import { Icon } from '../components/Icon'
import { formatBytes, formatNumber, formatRelativeTime } from '../utils/format'
import type { ThemeName } from '../types'

const THEME_CYCLE: ThemeName[] = ['light', 'sepia', 'dark', 'comfort']
const THEME_LABEL: Record<ThemeName, string> = { light: 'Light', sepia: 'Sepia', dark: 'Dark', comfort: 'Eye comfort' }

export function LibraryScreen() {
  const { entries, error, refresh } = useLibrary()
  const jobs = useExtractionJobs()
  const settings = useSettings()
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)

  useEffect(() => {
    estimateStorage().then(setStorage)
  }, [entries])

  const choose = () => inputRef.current?.click()

  const acceptFiles = useCallback((files: FileList | File[] | null) => {
    const list = Array.from(files ?? [])
    if (!list.length) return
    const pdf = list.find((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name))
    if (!pdf) {
      setNotice('That file isn’t a PDF. Please choose a .pdf file.')
      return
    }
    setNotice(null)
    setPendingFile(pdf)
  }, [])

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    acceptFiles(e.dataTransfer.files)
  }

  const books = entries ?? []
  const recent = books.find((e) => e.progress && e.book.processedPages > 0)

  return (
    <div
      className="min-h-full"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        dragDepth.current++
        setDragging(true)
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (!dragDepth.current) setDragging(false)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          acceptFiles(e.target.files)
          e.target.value = ''
        }}
      />

      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 pb-4 pt-8 sm:px-10">
        <button type="button" onClick={() => setPendingFile(null)} className="flex items-baseline gap-2.5" aria-label="Folio library">
          <span className="font-serif text-[26px] font-semibold tracking-tight text-ink">Folio</span>
          <span className="hidden text-[13px] text-ink-faint sm:inline">PDF book reader</span>
        </button>
        <div className="flex items-center gap-1">
          <IconButton
            icon={settings.theme === 'dark' || settings.theme === 'comfort' ? 'moon' : 'sun'}
            label={`Theme: ${THEME_LABEL[settings.theme]}. Click to change`}
            tip={`Theme · ${THEME_LABEL[settings.theme]}`}
            tipPos="bottom"
            onClick={() => updateSettings({ theme: THEME_CYCLE[(THEME_CYCLE.indexOf(settings.theme) + 1) % THEME_CYCLE.length] })}
          />
          {!pendingFile && (
            <Button variant="primary" icon="plus" onClick={choose} className="ml-2">
              Add PDF
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-20 sm:px-10">
        {pendingFile ? (
          <div className="pt-8">
            <UploadView
              file={pendingFile}
              existing={books.map((b) => b.book)}
              onCancel={() => setPendingFile(null)}
              onChooseAnother={choose}
            />
          </div>
        ) : (
          <>
            {notice && (
              <p role="alert" className="mb-6 flex items-center gap-2 rounded-xl bg-accent-soft px-4 py-3 text-[14px] text-ink">
                <Icon name="alert" size={16} className="text-accent" /> {notice}
              </p>
            )}
            {error && (
              <p role="alert" className="mb-6 rounded-xl bg-accent-soft px-4 py-3 text-[14px] text-ink">
                {error}
              </p>
            )}

            {entries && books.length === 0 && <EmptyState onChoose={choose} />}

            {recent && recent.progress && (
              <section aria-labelledby="continue-heading" className="fade-in mb-14 mt-6">
                <h2 id="continue-heading" className="mb-4 text-[12px] font-medium uppercase tracking-[0.14em] text-ink-faint">
                  Continue reading
                </h2>
                <div className="flex flex-col gap-6 rounded-3xl border border-line bg-paper-2/60 p-6 sm:flex-row sm:items-center sm:p-8">
                  <Cover blob={recent.book.cover} title={recent.book.title} className="h-[168px] w-[122px] shrink-0" />
                  <div className="min-w-0 flex-1">
                    <h3 className="font-serif text-[26px] font-semibold leading-tight text-ink">{recent.book.title}</h3>
                    {recent.book.author && <p className="mt-1 text-ink-soft">{recent.book.author}</p>}
                    <p className="mt-4 text-[14px] text-ink-soft">
                      Page {formatNumber(recent.progress.page)} of {formatNumber(recent.book.pageCount)} · {Math.round(recent.progress.percentage)}% complete · {formatRelativeTime(recent.progress.updatedAt)}
                    </p>
                    <ProgressBar value={recent.progress.percentage / 100} className="mt-3 max-w-md" />
                  </div>
                  <Button variant="primary" size="lg" icon="book-open" onClick={() => navigate({ name: 'reader', bookId: recent.book.id })}>
                    Continue Reading
                  </Button>
                </div>
              </section>
            )}

            {books.length > 0 && (
              <section aria-labelledby="library-heading">
                <div className="mb-4 flex items-baseline justify-between">
                  <h2 id="library-heading" className="text-[12px] font-medium uppercase tracking-[0.14em] text-ink-faint">
                    Your library · {books.length}
                  </h2>
                  {storage && storage.quota > 0 && (
                    <span className="text-[12px] text-ink-faint" title="Space used by Folio in this browser">
                      {formatBytes(storage.usage)} used of {formatBytes(storage.quota)} available
                    </span>
                  )}
                </div>
                <div className="grid gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
                  {books.map((entry) => (
                    <BookCard
                      key={entry.book.id}
                      entry={entry}
                      job={jobs.get(entry.book.id)}
                      onOpen={() => navigate({ name: 'reader', bookId: entry.book.id })}
                      onShowProcessing={() => navigate({ name: 'processing', bookId: entry.book.id })}
                      onResumeExtraction={() => {
                        extraction.start(entry.book.id)
                        navigate({ name: 'processing', bookId: entry.book.id })
                      }}
                      onReextract={() => {
                        extraction.start(entry.book.id, { restart: true })
                        navigate({ name: 'processing', bookId: entry.book.id })
                      }}
                      onDelete={async () => {
                        extraction.forget(entry.book.id)
                        await deleteBook(entry.book.id)
                        refresh()
                      }}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={choose}
                    className="flex min-h-[156px] items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong text-[14px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
                  >
                    <Icon name="plus" size={16} /> Add PDF
                  </button>
                </div>
              </section>
            )}
          </>
        )}
      </main>

      <div
        aria-hidden={!dragging}
        className={cx(
          'pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-paper/80 backdrop-blur-sm transition-opacity duration-200',
          dragging ? 'opacity-100' : 'opacity-0',
        )}
      >
        <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-accent px-16 py-12 text-accent">
          <Icon name="upload" size={32} />
          <p className="font-serif text-xl">Drop your PDF to add it</p>
        </div>
      </div>
    </div>
  )
}

function EmptyState({ onChoose }: { onChoose: () => void }) {
  return (
    <section className="fade-in mx-auto mt-16 max-w-xl text-center">
      <button
        type="button"
        onClick={onChoose}
        className="group flex w-full flex-col items-center rounded-3xl border border-dashed border-line-strong px-8 py-16 transition-colors hover:border-accent hover:bg-accent-soft/40"
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-accent transition-transform group-hover:-translate-y-0.5">
          <Icon name="upload" size={24} />
        </span>
        <span className="mt-6 font-serif text-[24px] font-semibold text-ink">Add your first book</span>
        <span className="mt-2 text-[15px] leading-relaxed text-ink-soft">Drag and drop a PDF here, or click to choose one.</span>
        <span className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-accent px-6 text-[15px] font-medium text-accent-ink">Choose PDF</span>
      </button>
      <p className="mt-6 text-[13px] leading-relaxed text-ink-faint">
        Everything stays on this device. Books are processed in your browser and saved locally, so large books (1,000+ pages) only need to be extracted once.
      </p>
    </section>
  )
}
