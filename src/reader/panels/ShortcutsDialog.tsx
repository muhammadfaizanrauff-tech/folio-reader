import { useEffect, useRef } from 'react'
import { IconButton, Kbd } from '../../components/ui'

const SHORTCUTS: [string[], string][] = [
  [['Space'], 'Start / pause auto-scroll'],
  [['R'], 'Start or resume reading'],
  [['L'], 'Read aloud: play / pause (turns it on)'],
  [['→', ']'], 'Faster auto-scroll'],
  [['←', '['], 'Slower auto-scroll'],
  [['↑', '↓'], 'Scroll a few lines (pauses auto-scroll)'],
  [['PgUp', 'PgDn'], 'Scroll a screen'],
  [['+', '−'], 'Font size (zoom in PDF view)'],
  [[',', '.'], 'Fewer / more words per line'],
  [['F'], 'Toggle fullscreen'],
  [['Esc'], 'Close panel / exit fullscreen'],
  [['/', '⌘F'], 'Search the book'],
  [['T'], 'Table of contents'],
  [['S'], 'Reading settings'],
  [['M'], 'Switch Reading / PDF view'],
  [['D'], 'Cycle theme'],
  [['Home', 'End'], 'Beginning / end of book'],
  [['?'], 'Show this help'],
]

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(520px,calc(100vw-32px))] rounded-2xl border border-line bg-panel p-0 text-ink shadow-float backdrop:bg-black/30 backdrop:backdrop-blur-[2px]"
      aria-labelledby="shortcuts-title"
    >
      <div className="flex items-center px-6 pb-2 pt-5">
        <h2 id="shortcuts-title" className="flex-1 text-[16px] font-semibold">
          Keyboard shortcuts
        </h2>
        <IconButton icon="x" label="Close" tip={false} size="sm" onClick={onClose} />
      </div>
      <ul className="grid gap-x-6 px-6 pb-6 sm:grid-cols-1">
        {SHORTCUTS.map(([keys, desc]) => (
          <li key={desc} className="flex items-center justify-between gap-4 border-b border-line py-2 text-[13px] last:border-0">
            <span className="text-ink-soft">{desc}</span>
            <span className="flex shrink-0 gap-1">
              {keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </dialog>
  )
}
