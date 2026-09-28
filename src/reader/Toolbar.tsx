import { useEffect, useRef, useState, type ReactNode } from 'react'
import { IconButton } from '../components/ui'
import { cx } from '../utils/cx'
import { Icon } from '../components/Icon'
import { LIMITS, sliderToSpeed, speedLabel, speedToSlider, stepSpeed, updateSettings, useSettings } from '../storage/settings'
import { useAutoScrollState, type ScrollController } from './scrollController'
import { FontPicker, ThemePicker } from './panels/SettingsPanel'
import { LineWidthControl } from './LineWidthControl'
import { useLineWidth } from './lineWidth'
import type { ViewMode } from '../types'
import type { PdfZoom } from './PdfReader'

function Popover({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.parentElement?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className="fade-in absolute bottom-[calc(100%+14px)] left-1/2 w-[320px] -translate-x-1/2 rounded-2xl border border-line bg-panel p-4 shadow-float backdrop-blur-xl"
    >
      {children}
    </div>
  )
}

interface ToolbarProps {
  controller: ScrollController
  viewMode: ViewMode
  isFullscreen: boolean
  onToggleFullscreen: () => void
  onOpenSettings: () => void
  zoom: PdfZoom
  effectiveScale: number
  onZoom: (z: PdfZoom) => void
  readAloud: boolean
  onToggleReadAloud: () => void
}

export function Toolbar({ controller, viewMode, isFullscreen, onToggleFullscreen, onOpenSettings, zoom, effectiveScale, onZoom, readAloud, onToggleReadAloud }: ToolbarProps) {
  const s = useSettings()
  const auto = useAutoScrollState(controller)
  const [pop, setPop] = useState<'font' | 'theme' | 'width' | null>(null)
  const line = useLineWidth()
  const running = auto.state === 'running'
  const sliderPos = speedToSlider(s.autoScrollSpeed)

  return (
    <div className="flex max-w-[calc(100vw-24px)] items-center gap-1 overflow-visible rounded-full border border-line bg-panel px-2 py-1.5 shadow-float backdrop-blur-xl">
      <button
        type="button"
        onClick={() => controller.toggle()}
        aria-label={running ? 'Pause auto-scroll (Space)' : auto.state === 'paused' ? 'Resume auto-scroll (Space)' : 'Start auto-scroll (Space)'}
        data-tip={running ? 'Pause · Space' : auto.state === 'paused' ? 'Resume · Space' : 'Start auto-scroll · Space'}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink shadow-sm transition-transform hover:scale-105 active:scale-95"
      >
        <Icon name={running ? 'pause' : 'play'} size={18} />
      </button>
      {auto.state !== 'idle' && <IconButton icon="stop" label="Stop auto-scroll" iconSize={14} onClick={() => controller.stop()} />}

      <div className="mx-1 hidden items-center gap-1 sm:flex" role="group" aria-label="Auto-scroll speed">
        <IconButton icon="minus" label="Slower (← or [)" size="sm" onClick={() => updateSettings({ autoScrollSpeed: stepSpeed(s.autoScrollSpeed, -1) })} />
        <div className="flex w-[124px] flex-col md:w-[150px]">
          <input
            type="range"
            className="range"
            min={0}
            max={1000}
            step={1}
            value={sliderPos}
            aria-label="Auto-scroll speed"
            aria-valuetext={`${speedLabel(s.autoScrollSpeed)}, ${s.autoScrollSpeed} pixels per second`}
            style={{ ['--pct' as string]: `${sliderPos / 10}%` }}
            onChange={(e) => updateSettings({ autoScrollSpeed: sliderToSpeed(Number(e.target.value)) })}
          />
          <span className="-mt-0.5 text-center text-[10.5px] font-medium tabular-nums leading-none text-ink-faint">
            {speedLabel(s.autoScrollSpeed)} · {s.autoScrollSpeed}
          </span>
        </div>
        <IconButton icon="plus" label="Faster (→ or ])" size="sm" onClick={() => updateSettings({ autoScrollSpeed: stepSpeed(s.autoScrollSpeed, 1) })} />
      </div>

      <span className="mx-1 hidden h-6 w-px bg-line sm:block" />

      {viewMode === 'text' ? (
        <>
          <div className="relative">
            <button
              type="button"
              onClick={() => setPop(pop === 'font' ? null : 'font')}
              aria-label="Font"
              aria-expanded={pop === 'font'}
              data-tip={pop ? undefined : 'Font'}
              className={cx('flex h-10 items-center rounded-full px-3 font-serif text-[16px] text-ink-soft hover:bg-hover hover:text-ink', pop === 'font' && 'bg-hover text-ink')}
            >
              Aa
            </button>
            <Popover open={pop === 'font'} onClose={() => setPop(null)} label="Font">
              <FontPicker />
            </Popover>
          </div>
          <div className="flex items-center" role="group" aria-label="Font size">
            <IconButton icon="minus" label="Smaller text (−)" size="sm" disabled={s.fontSize <= LIMITS.fontSize.min} onClick={() => updateSettings({ fontSize: s.fontSize - 1 })} />
            <span className="w-7 text-center text-[12px] tabular-nums text-ink-soft" aria-live="polite" aria-label={`Font size ${s.fontSize} pixels`}>
              {s.fontSize}
            </span>
            <IconButton icon="plus" label="Larger text (+)" size="sm" disabled={s.fontSize >= LIMITS.fontSize.max} onClick={() => updateSettings({ fontSize: s.fontSize + 1 })} />
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setPop(pop === 'width' ? null : 'width')}
              aria-label={`Line width: ${line.words} words per line`}
              aria-expanded={pop === 'width'}
              data-tip={pop ? undefined : 'Line width · words per line'}
              className={cx(
                'flex h-10 items-center gap-1.5 rounded-full px-2.5 text-ink-soft hover:bg-hover hover:text-ink',
                pop === 'width' && 'bg-hover text-ink',
              )}
            >
              <Icon name="line-width" size={18} />
              <span className="text-[12px] font-medium tabular-nums">{line.isFull ? 'Full' : line.words}</span>
            </button>
            <Popover open={pop === 'width'} onClose={() => setPop(null)} label="Line width">
              <p className="mb-3 text-[13px] font-semibold text-ink">Line width</p>
              <LineWidthControl compact />
              <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">Shortcut: , and . for fewer / more words</p>
            </Popover>
          </div>
        </>
      ) : (
        <div className="flex items-center" role="group" aria-label="Zoom">
          <IconButton icon="zoom-out" label="Zoom out (−)" size="sm" onClick={() => onZoom(Math.max(0.25, +(effectiveScale / 1.2).toFixed(2)))} />
          <button
            type="button"
            onClick={() => onZoom('fit')}
            data-tip="Fit to width"
            className={cx('h-8 min-w-[52px] rounded-full px-2 text-[12px] tabular-nums hover:bg-hover', zoom === 'fit' ? 'text-accent' : 'text-ink-soft')}
          >
            {Math.round(effectiveScale * 100)}%
          </button>
          <IconButton icon="zoom-in" label="Zoom in (+)" size="sm" onClick={() => onZoom(Math.min(4, +(effectiveScale * 1.2).toFixed(2)))} />
        </div>
      )}

      <div className="relative">
        <IconButton
          icon="palette"
          label="Theme"
          tip={pop ? false : 'Theme'}
          active={pop === 'theme'}
          onClick={() => setPop(pop === 'theme' ? null : 'theme')}
          aria-expanded={pop === 'theme'}
        />
        <Popover open={pop === 'theme'} onClose={() => setPop(null)} label="Theme">
          <ThemePicker compact />
          <button
            type="button"
            onClick={() => updateSettings({ ambientEnabled: !s.ambientEnabled })}
            className={cx(
              'mt-3 flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-[13px]',
              s.ambientEnabled ? 'border-accent bg-accent-soft text-ink' : 'border-line text-ink-soft hover:text-ink',
            )}
            aria-pressed={s.ambientEnabled}
          >
            <Icon name="lamp" size={16} /> Ambient light {s.ambientEnabled ? 'on' : 'off'}
          </button>
        </Popover>
      </div>
      <IconButton
        icon={readAloud ? 'volume' : 'volume-off'}
        label={readAloud ? 'Turn off Read aloud' : 'Turn on Read aloud (L)'}
        tip={readAloud ? 'Read aloud: on' : 'Read aloud: off'}
        active={readAloud}
        aria-pressed={readAloud}
        onClick={onToggleReadAloud}
      />
      <IconButton icon={isFullscreen ? 'minimize' : 'maximize'} label={isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'} onClick={onToggleFullscreen} />
      <IconButton icon="sliders" label="Reading settings (S)" onClick={onOpenSettings} />
    </div>
  )
}
