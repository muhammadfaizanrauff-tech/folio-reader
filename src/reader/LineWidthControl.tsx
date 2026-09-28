import { IconButton } from '../components/ui'
import { cx } from '../utils/cx'
import { MIN_WORDS, useLineWidth } from './lineWidth'

const PRESETS = [
  { label: 'Narrow', words: 9 },
  { label: 'Comfortable', words: 13 },
  { label: 'Wide', words: 18 },
  { label: 'Extra wide', words: 25 },
]

/** "How many words per line" – buttons, slider and presets. */
export function LineWidthControl({ compact }: { compact?: boolean }) {
  const { words, maxWords, isFull, setWords, step, setFull } = useLineWidth()
  const pct = maxWords > MIN_WORDS ? ((Math.min(words, maxWords) - MIN_WORDS) / (maxWords - MIN_WORDS)) * 100 : 100

  return (
    <div>
      {!compact && <p className="mb-1.5 text-[13px] font-medium text-ink-soft">Line width</p>}
      <div className="flex items-center gap-2">
        <IconButton icon="minus" label="Fewer words per line (,)" size="sm" disabled={words <= MIN_WORDS} onClick={() => step(-1)} />
        <div className="flex-1 text-center" aria-live="polite">
          <span className="text-[22px] font-semibold tabular-nums text-ink">{words}</span>
          <span className="ml-1.5 text-[13px] text-ink-soft">words per line</span>
          {isFull && <span className="block text-[11px] text-accent">Full width</span>}
        </div>
        <IconButton icon="plus" label="More words per line (.)" size="sm" disabled={isFull} onClick={() => step(1)} />
      </div>
      <input
        type="range"
        className="range mt-2"
        min={MIN_WORDS}
        max={maxWords}
        step={1}
        value={Math.min(words, maxWords)}
        aria-label="Words per line"
        aria-valuetext={`${words} words per line${isFull ? ', full width' : ''}`}
        style={{ ['--pct' as string]: `${pct}%` }}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (v >= maxWords) setFull()
          else setWords(v)
        }}
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {PRESETS.filter((p) => p.words < maxWords).map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => setWords(p.words)}
            className={cx(
              'rounded-full border px-2.5 py-1 text-[12px] transition-colors',
              !isFull && Math.abs(words - p.words) <= 1 ? 'border-accent bg-accent-soft text-ink' : 'border-line text-ink-soft hover:text-ink',
            )}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={setFull}
          className={cx(
            'rounded-full border px-2.5 py-1 text-[12px] transition-colors',
            isFull ? 'border-accent bg-accent-soft text-ink' : 'border-line text-ink-soft hover:text-ink',
          )}
        >
          Full width
        </button>
      </div>
    </div>
  )
}
