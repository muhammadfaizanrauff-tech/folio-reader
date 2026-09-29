import { useEffect, useRef, useState, type ReactNode } from 'react'
import { IconButton } from '../components/ui'
import { cx } from '../utils/cx'
import { Icon } from '../components/Icon'
import { FONT_OPTIONS, LIMITS, sliderToSpeed, speedLabel, speedToSlider, stepSpeed, updateSettings, useSettings } from '../storage/settings'
import { useAutoScrollState, type ScrollController } from './scrollController'
import { ThemePicker } from './panels/SettingsPanel'
import { SPEED_PRESETS } from './presets'
import { MIN_WORDS, useLineWidth } from './lineWidth'
import type { ViewMode } from '../types'
import type { PdfZoom } from './PdfReader'

/**
 * The floating reading toolbar.
 *
 * Deliberately small (Hick's law): play, speed, one "Aa" display panel
 * (theme, size, font, line width – like Kindle / Apple Books), read aloud,
 * and "more" for everything else. Buttons are ≥44px on touch screens.
 */

function Popover({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      // Clicks on the toolbar itself are handled by its buttons (they toggle panels).
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
      className="fade-in thin-scroll absolute bottom-[calc(100%+12px)] left-1/2 max-h-[min(70vh,560px)] w-[min(360px,calc(100vw-24px))] -translate-x-1/2 overflow-y-auto rounded-3xl border border-line bg-panel p-5 shadow-float backdrop-blur-xl"
    >
      {children}
    </div>
  )
}

function Row({ label, children, value }: { label: string; children: ReactNode; value?: ReactNode }) {
  return (
    <div className="border-t border-line py-4 first:border-t-0 first:pt-0 last:pb-0">
      <div className="mb-2.5 flex items-baseline justify-between">
        <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-faint">{label}</span>
        {value && <span className="text-[12px] tabular-nums text-ink-soft">{value}</span>}
      </div>
      {children}
    </div>
  )
}

/** A big, touch-friendly "− value +" stepper. */
function Stepper({
  onMinus,
  onPlus,
  minusLabel,
  plusLabel,
  minusDisabled,
  plusDisabled,
  children,
  minusIcon,
  plusIcon,
}: {
  onMinus: () => void
  onPlus: () => void
  minusLabel: string
  plusLabel: string
  minusDisabled?: boolean
  plusDisabled?: boolean
  children: ReactNode
  minusIcon?: ReactNode
  plusIcon?: ReactNode
}) {
  const btn = 'flex h-11 flex-1 items-center justify-center rounded-2xl bg-paper-2 text-ink transition-colors hover:bg-hover active:scale-[0.98] disabled:opacity-35'
  return (
    <div className="flex items-center gap-2">
      <button type="button" className={btn} onClick={onMinus} disabled={minusDisabled} aria-label={minusLabel}>
        {minusIcon ?? <Icon name="minus" size={18} />}
      </button>
      <div className="min-w-[88px] text-center" aria-live="polite">
        {children}
      </div>
      <button type="button" className={btn} onClick={onPlus} disabled={plusDisabled} aria-label={plusLabel}>
        {plusIcon ?? <Icon name="plus" size={18} />}
      </button>
    </div>
  )
}

function DisplayPanel({ viewMode, zoom, effectiveScale, onZoom, onMore }: { viewMode: ViewMode; zoom: PdfZoom; effectiveScale: number; onZoom: (z: PdfZoom) => void; onMore: () => void }) {
  const s = useSettings()
  const line = useLineWidth()
  const quickFonts = FONT_OPTIONS.filter((f) => ['literata', 'georgia', 'merriweather', 'lora', 'inter', 'open-sans'].includes(f.id))
  return (
    <div>
      <Row label="Theme">
        <ThemePicker compact />
      </Row>

      {viewMode === 'text' ? (
        <>
          <Row label="Text size" value={`${s.fontSize}px`}>
            <Stepper
              onMinus={() => updateSettings({ fontSize: s.fontSize - 1 })}
              onPlus={() => updateSettings({ fontSize: s.fontSize + 1 })}
              minusDisabled={s.fontSize <= LIMITS.fontSize.min}
              plusDisabled={s.fontSize >= LIMITS.fontSize.max}
              minusLabel="Smaller text"
              plusLabel="Larger text"
              minusIcon={<span className="font-serif text-[15px]">A</span>}
              plusIcon={<span className="font-serif text-[22px]">A</span>}
            >
              <span className="font-serif text-[20px] text-ink">Aa</span>
            </Stepper>
          </Row>

          <Row label="Font">
            <div role="radiogroup" aria-label="Font" className="grid grid-cols-3 gap-1.5">
              {quickFonts.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={s.fontFamily === f.id}
                  onClick={() => updateSettings({ fontFamily: f.id })}
                  className={cx(
                    'h-11 truncate rounded-xl border px-1.5 text-[13px] transition-colors',
                    s.fontFamily === f.id ? 'border-accent bg-accent-soft text-ink' : 'border-line text-ink-soft hover:text-ink',
                  )}
                  style={{ fontFamily: f.stack }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </Row>

          <Row label="Line width" value={line.isFull ? 'Full width' : undefined}>
            <Stepper
              onMinus={() => line.step(-1)}
              onPlus={() => line.step(1)}
              minusDisabled={line.words <= MIN_WORDS}
              plusDisabled={line.isFull}
              minusLabel="Fewer words per line"
              plusLabel="More words per line"
            >
              <span className="block text-[20px] font-semibold tabular-nums leading-tight text-ink">{line.words}</span>
              <span className="block text-[11px] text-ink-faint">words per line</span>
            </Stepper>
          </Row>
        </>
      ) : (
        <Row label="Zoom">
          <Stepper
            onMinus={() => onZoom(Math.max(0.25, +(effectiveScale / 1.2).toFixed(2)))}
            onPlus={() => onZoom(Math.min(4, +(effectiveScale * 1.2).toFixed(2)))}
            minusLabel="Zoom out"
            plusLabel="Zoom in"
            minusIcon={<Icon name="zoom-out" size={18} />}
            plusIcon={<Icon name="zoom-in" size={18} />}
          >
            <button type="button" onClick={() => onZoom('fit')} className="text-[18px] font-semibold tabular-nums text-ink" title="Fit to width">
              {Math.round(effectiveScale * 100)}%
            </button>
            <span className={cx('block text-[11px]', zoom === 'fit' ? 'text-accent' : 'text-ink-faint')}>{zoom === 'fit' ? 'fit to width' : 'tap to fit'}</span>
          </Stepper>
        </Row>
      )}

      <Row label="Comfort">
        <button
          type="button"
          onClick={() => updateSettings({ ambientEnabled: !s.ambientEnabled })}
          aria-pressed={s.ambientEnabled}
          className={cx(
            'flex h-11 w-full items-center gap-2.5 rounded-xl border px-3 text-[14px] transition-colors',
            s.ambientEnabled ? 'border-accent bg-accent-soft text-ink' : 'border-line text-ink-soft hover:text-ink',
          )}
        >
          <Icon name="lamp" size={17} />
          <span className="flex-1 text-left">Warm ambient light</span>
          <span className={cx('text-[12px] font-medium', s.ambientEnabled ? 'text-accent' : 'text-ink-faint')}>{s.ambientEnabled ? 'On' : 'Off'}</span>
        </button>
      </Row>

      <button type="button" onClick={onMore} className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-[13px] font-medium text-accent hover:bg-hover">
        More reading settings <Icon name="chevron-right" size={14} />
      </button>
    </div>
  )
}

function SpeedPanel() {
  const s = useSettings()
  const pos = speedToSlider(s.autoScrollSpeed)
  return (
    <div>
      <Row label="Scroll speed" value={`${s.autoScrollSpeed} px/s`}>
        <Stepper
          onMinus={() => updateSettings({ autoScrollSpeed: stepSpeed(s.autoScrollSpeed, -1) })}
          onPlus={() => updateSettings({ autoScrollSpeed: stepSpeed(s.autoScrollSpeed, 1) })}
          minusLabel="Slower"
          plusLabel="Faster"
        >
          <span className="text-[18px] font-semibold text-ink">{speedLabel(s.autoScrollSpeed)}</span>
        </Stepper>
        <input
          type="range"
          className="range mt-3"
          min={0}
          max={1000}
          step={1}
          value={pos}
          aria-label="Auto-scroll speed"
          aria-valuetext={`${speedLabel(s.autoScrollSpeed)}, ${s.autoScrollSpeed} pixels per second`}
          style={{ ['--pct' as string]: `${pos / 10}%` }}
          onChange={(e) => updateSettings({ autoScrollSpeed: sliderToSpeed(Number(e.target.value)) })}
        />
        <div className="mt-3 grid grid-cols-5 gap-1">
          {SPEED_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => updateSettings({ autoScrollSpeed: p.value })}
              className={cx(
                'rounded-lg px-1 py-2 text-[11px] leading-tight transition-colors',
                speedLabel(s.autoScrollSpeed) === p.label ? 'bg-accent-soft font-medium text-ink' : 'text-ink-soft hover:bg-hover',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Row>
      <p className="mt-3 text-[12px] leading-relaxed text-ink-faint">Scroll by hand any time – auto-scroll pauses and waits for you. Keyboard: ← → to change speed.</p>
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

const tb = 'h-11 w-11'

export function Toolbar({ controller, viewMode, isFullscreen, onToggleFullscreen, onOpenSettings, zoom, effectiveScale, onZoom, readAloud, onToggleReadAloud }: ToolbarProps) {
  const s = useSettings()
  const auto = useAutoScrollState(controller)
  const [pop, setPop] = useState<'display' | 'speed' | null>(null)
  const running = auto.state === 'running'
  const toggle = (p: 'display' | 'speed') => setPop((cur) => (cur === p ? null : p))

  return (
    <div className="relative flex max-w-[calc(100vw-24px)] items-center gap-1 rounded-full border border-line bg-panel p-1.5 shadow-float backdrop-blur-xl">
      <button
        type="button"
        onClick={() => controller.toggle()}
        aria-label={running ? 'Pause auto-scroll (Space)' : auto.state === 'paused' ? 'Resume auto-scroll (Space)' : 'Start auto-scroll (Space)'}
        data-tip={running ? 'Pause · Space' : auto.state === 'paused' ? 'Resume · Space' : 'Scroll hands-free · Space'}
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink shadow-sm transition-transform hover:scale-105 active:scale-95"
      >
        <Icon name={running ? 'pause' : 'play'} size={19} />
      </button>
      {auto.state !== 'idle' && <IconButton icon="stop" label="Stop auto-scroll" tip="Stop" iconSize={13} className={cx(tb, 'max-sm:hidden')} onClick={() => controller.stop()} />}

      {/* Speed: one tap target that shows the current speed; details in a panel. */}
      <div className="flex items-center" role="group" aria-label="Auto-scroll speed">
        <IconButton icon="minus" label="Slower (←)" tip={false} className={cx(tb, 'max-sm:hidden')} onClick={() => updateSettings({ autoScrollSpeed: stepSpeed(s.autoScrollSpeed, -1) })} />
        <button
          type="button"
          onClick={() => toggle('speed')}
          aria-expanded={pop === 'speed'}
          aria-label={`Scroll speed: ${speedLabel(s.autoScrollSpeed)}. Change speed`}
          data-tip={pop ? undefined : 'Scroll speed'}
          className={cx(
            'flex h-11 min-w-[76px] flex-col items-center justify-center rounded-full px-3 leading-none transition-colors hover:bg-hover',
            pop === 'speed' && 'bg-hover',
          )}
        >
          <span className="text-[13px] font-medium text-ink">{speedLabel(s.autoScrollSpeed)}</span>
          <span className="mt-1 text-[10.5px] tabular-nums text-ink-faint">{s.autoScrollSpeed} px/s</span>
        </button>
        <IconButton icon="plus" label="Faster (→)" tip={false} className={cx(tb, 'max-sm:hidden')} onClick={() => updateSettings({ autoScrollSpeed: stepSpeed(s.autoScrollSpeed, 1) })} />
      </div>

      <span className="mx-0.5 h-6 w-px bg-line" aria-hidden="true" />

      <button
        type="button"
        onClick={() => toggle('display')}
        aria-expanded={pop === 'display'}
        aria-label="Display: theme, text size, font and line width"
        data-tip={pop ? undefined : 'Display'}
        className={cx('flex h-11 w-12 items-center justify-center rounded-full font-serif text-[18px] text-ink-soft transition-colors hover:bg-hover hover:text-ink', pop === 'display' && 'bg-hover text-ink')}
      >
        Aa
      </button>
      <IconButton
        icon={readAloud ? 'volume' : 'volume-off'}
        label={readAloud ? 'Turn off Read aloud' : 'Turn on Read aloud (L)'}
        tip={readAloud ? 'Read aloud: on' : 'Read aloud'}
        active={readAloud}
        aria-pressed={readAloud}
        className={tb}
        onClick={onToggleReadAloud}
      />
      <IconButton
        icon={isFullscreen ? 'minimize' : 'maximize'}
        label={isFullscreen ? 'Exit focus mode (F)' : 'Focus mode (F)'}
        tip={isFullscreen ? 'Exit focus mode' : 'Focus mode'}
        className={cx(tb, 'max-sm:hidden')}
        onClick={onToggleFullscreen}
      />
      <IconButton icon="sliders" label="All reading settings (S)" tip="More settings" className={tb} onClick={onOpenSettings} />

      <Popover open={pop === 'display'} onClose={() => setPop(null)} label="Display">
        <DisplayPanel
          viewMode={viewMode}
          zoom={zoom}
          effectiveScale={effectiveScale}
          onZoom={onZoom}
          onMore={() => {
            setPop(null)
            onOpenSettings()
          }}
        />
      </Popover>
      <Popover open={pop === 'speed'} onClose={() => setPop(null)} label="Scroll speed">
        <SpeedPanel />
      </Popover>
    </div>
  )
}
