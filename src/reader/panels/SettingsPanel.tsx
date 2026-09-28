import { Drawer, Section } from './Drawer'
import { Segmented, Slider, Toggle, Button } from '../../components/ui'
import { cx } from '../../utils/cx'
import { FONT_OPTIONS, LIMITS, resetSettings, sliderToSpeed, speedLabel, speedToSlider, stepSpeed, updateSettings, useSettings } from '../../storage/settings'
import { SPEED_PRESETS, THEMES } from '../presets'
import { LineWidthControl } from '../LineWidthControl'
import { SpeechOptions } from '../SpeechBar'

export function ThemePicker({ compact }: { compact?: boolean }) {
  const s = useSettings()
  return (
    <div role="radiogroup" aria-label="Reading theme" className="grid grid-cols-4 gap-2">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={s.theme === t.id}
          title={t.description}
          onClick={() => updateSettings({ theme: t.id, ...(t.id === 'comfort' && !s.ambientEnabled ? { ambientEnabled: true } : {}) })}
          className={cx('group flex flex-col items-center gap-1.5 rounded-xl p-1 text-[12px]', s.theme === t.id ? 'text-ink' : 'text-ink-soft')}
        >
          <span
            className={cx(
              'flex w-full items-center justify-center rounded-lg border font-serif text-[17px] transition-all',
              compact ? 'h-10' : 'h-12',
              s.theme === t.id ? 'border-accent ring-2 ring-accent/35' : 'border-line-strong group-hover:border-ink-faint',
            )}
            style={{ background: t.paper, color: t.ink }}
          >
            Aa
          </span>
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function FontPicker({ onPick }: { onPick?: () => void }) {
  const s = useSettings()
  return (
    <div role="radiogroup" aria-label="Font family" className="grid grid-cols-2 gap-1.5">
      {FONT_OPTIONS.map((f) => (
        <button
          key={f.id}
          type="button"
          role="radio"
          aria-checked={s.fontFamily === f.id}
          onClick={() => {
            updateSettings({ fontFamily: f.id })
            onPick?.()
          }}
          className={cx(
            'rounded-lg border px-3 py-2 text-left text-[15px] transition-colors',
            s.fontFamily === f.id ? 'border-accent bg-accent-soft text-ink' : 'border-line text-ink-soft hover:border-line-strong hover:text-ink',
          )}
          style={{ fontFamily: f.stack }}
        >
          {f.label}
        </button>
      ))}
    </div>
  )
}

export function SpeedControl({ showPresets = true }: { showPresets?: boolean }) {
  const s = useSettings()
  return (
    <div>
      <Slider
        label="Auto-scroll speed"
        value={speedToSlider(s.autoScrollSpeed)}
        min={0}
        max={1000}
        step={1}
        onChange={(v) => updateSettings({ autoScrollSpeed: sliderToSpeed(v) })}
        format={() => `${speedLabel(s.autoScrollSpeed)} · ${s.autoScrollSpeed} px/s`}
        steppers
        onStep={(d) => updateSettings({ autoScrollSpeed: stepSpeed(s.autoScrollSpeed, d) })}
      />
      {showPresets && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {SPEED_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => updateSettings({ autoScrollSpeed: p.value })}
              className={cx(
                'rounded-full border px-2.5 py-1 text-[12px] transition-colors',
                speedLabel(s.autoScrollSpeed) === p.label ? 'border-accent bg-accent-soft text-ink' : 'border-line text-ink-soft hover:text-ink',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function SettingsPanel({
  open,
  onClose,
  onShowShortcuts,
  onToggleReadAloud,
}: {
  open: boolean
  onClose: () => void
  onShowShortcuts: () => void
  onToggleReadAloud: (on: boolean) => void
}) {
  const s = useSettings()
  return (
    <Drawer open={open} side="right" title="Reading settings" onClose={onClose}>
      <Section title="Theme">
        <ThemePicker />
        <Toggle
          label="Ambient light"
          description="Warm, softened screen tint for long sessions"
          checked={s.ambientEnabled}
          onChange={(v) => updateSettings({ ambientEnabled: v })}
        />
        {s.ambientEnabled && (
          <div className="space-y-4 rounded-xl bg-paper-2/70 p-3">
            <Slider label="Warmth" value={s.ambientWarmth} min={0} max={100} step={1} onChange={(v) => updateSettings({ ambientWarmth: v })} format={(v) => `${v}%`} />
            <Slider label="Dimming" value={s.ambientDim} min={0} max={100} step={1} onChange={(v) => updateSettings({ ambientDim: v })} format={(v) => `${v}%`} />
          </div>
        )}
      </Section>

      <Section title="Font">
        <FontPicker />
        <Slider
          label="Font size"
          value={s.fontSize}
          {...LIMITS.fontSize}
          onChange={(v) => updateSettings({ fontSize: v })}
          format={(v) => `${v}px`}
          steppers
        />
      </Section>

      <Section title="Layout">
        <Slider label="Line spacing" value={s.lineHeight} {...LIMITS.lineHeight} onChange={(v) => updateSettings({ lineHeight: v })} format={(v) => v.toFixed(2)} />
        <Slider
          label="Paragraph spacing"
          value={s.paragraphSpacing}
          {...LIMITS.paragraphSpacing}
          onChange={(v) => updateSettings({ paragraphSpacing: v })}
          format={(v) => `${v.toFixed(2)} em`}
        />
        <LineWidthControl />
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-ink-soft">Alignment</p>
          <Segmented
            label="Text alignment"
            value={s.textAlign}
            onChange={(v) => updateSettings({ textAlign: v })}
            options={[
              { value: 'left', label: 'Left' },
              { value: 'justify', label: 'Justified' },
            ]}
          />
        </div>
        <Toggle label="Page numbers" description="Show original page breaks in the text" checked={s.showPageMarkers} onChange={(v) => updateSettings({ showPageMarkers: v })} />
      </Section>

      <Section title="Auto-scroll">
        <SpeedControl />
        <p className="text-[12px] leading-relaxed text-ink-faint">Your speed is saved automatically. Scrolling manually pauses auto-scroll; press Space to resume.</p>
      </Section>

      <Section title="Read aloud">
        <Toggle
          label="Read aloud"
          description="Speaks the book with your device’s voices and highlights each word. Separate from auto-scroll."
          checked={s.readAloud}
          onChange={onToggleReadAloud}
        />
        {s.readAloud && (
          <>
            <SpeechOptions />
            <p className="text-[12px] leading-relaxed text-ink-faint">Click any word to start reading from there. L plays / pauses.</p>
          </>
        )}
      </Section>

      <div className="flex items-center justify-between border-t border-line pt-5">
        <Button size="sm" variant="ghost" icon="keyboard" onClick={onShowShortcuts}>
          Shortcuts
        </Button>
        <Button size="sm" variant="ghost" icon="refresh" onClick={() => resetSettings({ theme: s.theme, autoScrollSpeed: s.autoScrollSpeed })}>
          Reset typography
        </Button>
      </div>
    </Drawer>
  )
}
