import { useMemo } from 'react'
import { IconButton, Slider } from '../components/ui'
import { Icon } from '../components/Icon'
import { LIMITS, updateSettings, useSettings } from '../storage/settings'
import { cx } from '../utils/cx'
import { defaultVoice, isNoveltyVoice, speechSupported, useSpeech, useVoices, type SpeechReader } from './speech'

/** Voice picker + speed slider, shared by the listening bar and the settings panel. */
export function SpeechOptions({ compact }: { compact?: boolean }) {
  const s = useSettings()
  const voices = useVoices()
  const sorted = useMemo(() => {
    const lang = (navigator.language || 'en').split('-')[0].toLowerCase()
    // Your language first, natural voices before novelty ones, then alphabetical.
    const rank = (v: SpeechSynthesisVoice) => (v.lang.toLowerCase().startsWith(lang) ? 0 : 2) + (isNoveltyVoice(v) ? 1 : 0)
    return [...voices].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  }, [voices])
  const auto = defaultVoice(voices)

  if (!speechSupported) return <p className="text-[12px] text-ink-faint">This browser doesn’t support reading aloud.</p>

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      <div>
        <label htmlFor={compact ? 'voice-compact' : 'voice'} className="mb-1.5 block text-[13px] font-medium text-ink-soft">
          Voice
        </label>
        <select
          id={compact ? 'voice-compact' : 'voice'}
          value={s.speechVoice}
          onChange={(e) => updateSettings({ speechVoice: e.target.value })}
          className="h-9 w-full rounded-lg border border-line-strong bg-paper px-2 text-[13px] text-ink outline-none focus:border-accent"
        >
          <option value="">Automatic{auto ? ` (${auto.name})` : ''}</option>
          {sorted.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name} · {v.lang}
              {v.localService ? '' : ' (online)'}
            </option>
          ))}
        </select>
        {voices.length === 0 && <p className="mt-1 text-[11px] text-ink-faint">Loading voices… (install more in your system’s speech settings)</p>}
      </div>
      <Slider
        label="Reading speed"
        value={s.speechRate}
        {...LIMITS.speechRate}
        onChange={(v) => updateSettings({ speechRate: +v.toFixed(2) })}
        format={(v) => `${v.toFixed(2).replace(/0$/, '')}×`}
        steppers
      />
    </div>
  )
}

interface BarProps {
  speech: SpeechReader
  follow: boolean
  onFollow: () => void
  onPlay: () => void
  onTurnOff: () => void
  onOpenOptions: () => void
}

/** Floating "listening" controls, shown while the Read aloud feature is switched on. */
export function SpeechBar({ speech, follow, onFollow, onPlay, onTurnOff, onOpenOptions }: BarProps) {
  const snap = useSpeech(speech)
  const s = useSettings()
  const playing = snap.status === 'playing' || snap.status === 'loading'
  const active = snap.status !== 'idle'

  let status = 'Press play, or click any word to start there'
  if (snap.status === 'loading') status = 'Starting…'
  else if (snap.status === 'playing') status = `Reading · page ${snap.page}`
  else if (snap.status === 'paused') status = `Paused · page ${snap.page}`
  if (snap.error) status = snap.error

  return (
    <div role="group" aria-label="Read aloud controls" className="flex max-w-[calc(100vw-24px)] items-center gap-1 rounded-full border border-line bg-panel py-1 pl-2 pr-1.5 shadow-float backdrop-blur-xl">
      <span className="ml-1 mr-1 hidden text-accent sm:inline-flex" aria-hidden="true">
        <Icon name="volume" size={16} />
      </span>
      <IconButton icon="skip-back" label="Previous sentence" size="sm" disabled={!active} onClick={() => speech.skip(-1)} />
      <button
        type="button"
        onClick={onPlay}
        aria-label={playing ? 'Pause reading aloud (L)' : 'Read aloud (L)'}
        data-tip={playing ? 'Pause · L' : 'Read aloud · L'}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-paper transition-transform hover:scale-105 active:scale-95"
      >
        <Icon name={playing ? 'pause' : 'play'} size={15} />
      </button>
      <IconButton icon="skip-forward" label="Next sentence" size="sm" disabled={!active} onClick={() => speech.skip(1)} />
      {active && <IconButton icon="stop" label="Stop reading aloud" size="sm" iconSize={12} onClick={() => speech.stop()} />}

      <span className={cx('mx-2 min-w-0 max-w-[220px] truncate text-[12px]', snap.error ? 'text-danger' : 'text-ink-soft')} aria-live="polite">
        {status}
      </span>

      {active && !follow && (
        <button type="button" onClick={onFollow} className="flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-[12px] font-medium text-accent hover:brightness-95">
          <Icon name="crosshair" size={13} /> Follow
        </button>
      )}

      <button
        type="button"
        onClick={onOpenOptions}
        data-tip="Voice & speed"
        aria-label={`Voice and speed, currently ${s.speechRate}×`}
        className="ml-1 h-8 rounded-full px-2 text-[12px] font-medium tabular-nums text-ink-soft hover:bg-hover hover:text-ink"
      >
        {s.speechRate}×
      </button>
      <IconButton icon="x" label="Turn off Read aloud" size="sm" onClick={onTurnOff} />
    </div>
  )
}
