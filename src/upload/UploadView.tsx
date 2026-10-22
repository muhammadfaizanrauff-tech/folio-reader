import { useEffect, useRef, useState } from 'react'
import { importBook, inspectPdf, type PdfInfo } from '../pdf/inspect'
import { imagesToPdf, isImageFile } from '../pdf/images'
import { friendlyError, LARGE_FILE_BYTES, type FriendlyError } from '../pdf/errors'
import { extraction } from '../extraction/manager'
import { navigate } from '../router'
import { Button } from '../components/ui'
import { Icon } from '../components/Icon'
import { Cover } from '../library/BookCard'
import { formatBytes, formatNumber } from '../utils/format'
import type { Book } from '../types'

interface Props {
  /** One PDF, or one or more pictures (they become one book, a page per picture). */
  files: File[]
  existing: Book[]
  onCancel: () => void
  onChooseAnother: () => void
}

type Phase = { name: 'converting'; done: number; total: number } | { name: 'inspecting' } | { name: 'ready'; info: PdfInfo } | { name: 'error'; error: FriendlyError } | { name: 'importing'; info: PdfInfo }

export function UploadView({ files, existing, onCancel, onChooseAnother }: Props) {
  const pictures = files.length > 0 && files.every(isImageFile)
  const [phase, setPhase] = useState<Phase>(pictures ? { name: 'converting', done: 0, total: files.length } : { name: 'inspecting' })
  // The PDF being imported: the chosen file, or the one built from the pictures.
  const [file, setFile] = useState<File>(files[0])
  const [password, setPassword] = useState('')
  const [attempt, setAttempt] = useState(0)
  const submittedPassword = useRef<string | undefined>(undefined)

  useEffect(() => {
    let alive = true
    const run = async () => {
      let pdf = files[0]
      if (pictures) {
        setPhase({ name: 'converting', done: 0, total: files.length })
        pdf = await imagesToPdf(files, (done, total) => alive && setPhase({ name: 'converting', done, total }))
        if (!alive) return
      }
      setFile(pdf)
      setPhase({ name: 'inspecting' })
      const r = await inspectPdf(pdf, submittedPassword.current)
      if (!alive) return
      setPhase(r.ok ? { name: 'ready', info: r.info } : { name: 'error', error: r.error })
    }
    run().catch((err) => alive && setPhase({ name: 'error', error: friendlyError(err) }))
    return () => {
      alive = false
    }
  }, [files, pictures, attempt])

  const duplicate = !pictures && existing.find((b) => b.filename === file.name && b.fileSize === file.size)
  const busy = phase.name === 'converting' || phase.name === 'inspecting'
  const busyTitle = phase.name === 'converting' ? (phase.total > 1 ? `Preparing ${phase.total} pictures…` : 'Preparing picture…') : pictures ? 'Reading pictures…' : 'Reading PDF…'

  const start = async (info: PdfInfo) => {
    setPhase({ name: 'importing', info })
    try {
      const book = await importBook(info)
      extraction.start(book.id, { password: info.password })
      navigate({ name: 'processing', bookId: book.id })
    } catch (err) {
      setPhase({ name: 'error', error: friendlyError(err) })
    }
  }

  const needsPassword = phase.name === 'error' && (phase.error.kind === 'password-required' || phase.error.kind === 'password-incorrect')

  return (
    <div className="fade-in mx-auto w-full max-w-2xl">
      <button type="button" onClick={onCancel} className="mb-8 inline-flex items-center gap-1.5 text-[13px] text-ink-soft hover:text-ink">
        <Icon name="arrow-left" size={15} /> Library
      </button>

      <div className="flex flex-col gap-8 sm:flex-row sm:items-start">
        <div className="mx-auto shrink-0 sm:mx-0">
          {phase.name === 'ready' || phase.name === 'importing' ? (
            <Cover blob={phase.info.cover} title={phase.info.title} className="h-[236px] w-[172px]" />
          ) : (
            <div className="flex h-[236px] w-[172px] items-center justify-center rounded-[6px] border border-dashed border-line-strong bg-paper-2 text-ink-faint">
              {busy ? (
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-line-strong border-t-accent" aria-label={busyTitle} />
              ) : (
                <Icon name={needsPassword ? 'lock' : 'alert'} size={28} />
              )}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium uppercase tracking-[0.14em] text-ink-faint">{pictures ? (files.length > 1 ? `${files.length} pictures` : 'New picture') : 'New book'}</p>
          <h1 className="mt-2 font-serif text-[28px] font-semibold leading-tight text-ink">
            {phase.name === 'ready' || phase.name === 'importing' ? phase.info.title : busy ? busyTitle : phase.error.title}
          </h1>
          {(phase.name === 'ready' || phase.name === 'importing') && phase.info.author && <p className="mt-1 text-ink-soft">{phase.info.author}</p>}

          <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[14px]">
            <dt className="text-ink-faint">File</dt>
            <dd className="truncate text-ink" title={files.map((f) => f.name).join('\n')}>
              {pictures && files.length > 1 ? `${files[0].name} + ${files.length - 1} more` : files[0].name}
            </dd>
            <dt className="text-ink-faint">Size</dt>
            <dd className="text-ink">{formatBytes(files.reduce((n, f) => n + f.size, 0))}</dd>
            <dt className="text-ink-faint">Pages</dt>
            <dd className="text-ink">{phase.name === 'ready' || phase.name === 'importing' ? formatNumber(phase.info.pageCount) : '—'}</dd>
            {(phase.name === 'ready' || phase.name === 'importing') && (
              <>
                <dt className="text-ink-faint">Contents</dt>
                <dd className="text-ink">
                  {pictures ? 'Text will be recognized from the pictures' : phase.info.hasOutline ? 'Bookmarks found' : 'Will be generated from headings'}
                </dd>
              </>
            )}
          </dl>

          {phase.name === 'error' && (
            <div className="mt-6">
              <p className="text-[14px] leading-relaxed text-ink-soft">{phase.error.message}</p>
              {needsPassword && (
                <form
                  className="mt-4 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    submittedPassword.current = password
                    setAttempt((a) => a + 1)
                  }}
                >
                  <input
                    type="password"
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="PDF password"
                    aria-label="PDF password"
                    className="h-10 min-w-0 flex-1 rounded-full border border-line-strong bg-paper px-4 text-sm text-ink outline-none focus:border-accent"
                  />
                  <Button type="submit" variant="primary" icon="lock" disabled={!password}>
                    Unlock
                  </Button>
                </form>
              )}
              {phase.error.detail && (
                <details className="mt-4 text-[12px] text-ink-faint">
                  <summary className="cursor-pointer select-none">Technical details</summary>
                  <code className="mt-2 block break-all rounded-lg bg-paper-2 p-3">{phase.error.detail}</code>
                </details>
              )}
            </div>
          )}

          {phase.name === 'ready' && file.size > LARGE_FILE_BYTES && (
            <p className="mt-6 flex gap-2 rounded-xl bg-accent-soft p-3 text-[13px] leading-relaxed text-ink-soft">
              <Icon name="info" size={16} className="mt-0.5 shrink-0 text-accent" />
              This is a large file. Extraction runs in the background and may take several minutes; you can keep using the app meanwhile.
            </p>
          )}
          {phase.name === 'ready' && duplicate && (
            <p className="mt-6 flex gap-2 rounded-xl bg-paper-2 p-3 text-[13px] leading-relaxed text-ink-soft">
              <Icon name="info" size={16} className="mt-0.5 shrink-0" />
              <span>
                A book with this file name is already in your library.{' '}
                <button type="button" className="font-medium text-accent underline-offset-2 hover:underline" onClick={() => navigate({ name: 'reader', bookId: duplicate.id })}>
                  Open the existing copy
                </button>
              </span>
            </p>
          )}

          <div className="mt-8 flex flex-wrap items-center gap-3">
            {(phase.name === 'ready' || phase.name === 'importing') && (
              <Button variant="primary" size="lg" icon="book-open" onClick={() => start(phase.info)} disabled={phase.name === 'importing'} autoFocus>
                {phase.name === 'importing' ? 'Saving…' : 'Extract & Read'}
              </Button>
            )}
            <Button variant="ghost" onClick={onChooseAnother}>
              Choose another file
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
