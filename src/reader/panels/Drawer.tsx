import { useEffect, useRef, type ReactNode } from 'react'
import { IconButton } from '../../components/ui'
import { cx } from '../../utils/cx'

interface Props {
  open: boolean
  side: 'left' | 'right'
  title: string
  onClose: () => void
  children: ReactNode
  headerExtra?: ReactNode
  width?: number
}

/** Slide-in panel. Doesn't block the text: the book stays readable (and auto-scrollable) behind it. */
export function Drawer({ open, side, title, onClose, children, headerExtra, width = 360 }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (open) {
      returnFocus.current = document.activeElement as HTMLElement | null
      const t = setTimeout(() => {
        const first = ref.current?.querySelector<HTMLElement>('[data-autofocus], input, button:not([aria-label="Close panel"])')
        first?.focus({ preventScroll: true })
      }, 60)
      return () => clearTimeout(t)
    } else if (returnFocus.current && document.contains(returnFocus.current)) {
      returnFocus.current.focus({ preventScroll: true })
      returnFocus.current = null
    }
  }, [open])

  return (
    <aside
      ref={ref}
      aria-label={title}
      aria-hidden={!open}
      inert={!open}
      className={cx(
        'fixed bottom-3 top-3 z-40 flex max-w-[calc(100vw-24px)] flex-col rounded-2xl border border-line bg-panel shadow-float backdrop-blur-xl transition-all duration-300 ease-[cubic-bezier(.2,.8,.2,1)]',
        side === 'right' ? 'right-3' : 'left-3',
        open ? 'translate-x-0 opacity-100' : side === 'right' ? 'pointer-events-none translate-x-8 opacity-0' : 'pointer-events-none -translate-x-8 opacity-0',
      )}
      style={{ width }}
    >
      <div className="flex items-center gap-2 px-5 pb-2 pt-4">
        <h2 className="flex-1 text-[15px] font-semibold text-ink">{title}</h2>
        {headerExtra}
        <IconButton icon="x" label="Close panel" tip={false} size="sm" onClick={onClose} />
      </div>
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
    </aside>
  )
}

export function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cx('border-t border-line py-5 first:border-t-0', className)}>
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">{title}</h3>
      <div className="space-y-4">{children}</div>
    </section>
  )
}
