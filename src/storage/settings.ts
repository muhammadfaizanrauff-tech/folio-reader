import { useSyncExternalStore } from 'react'
import type { ReadingSettings } from '../types'

export interface FontOption {
  id: string
  label: string
  stack: string
  kind: 'serif' | 'sans'
}

/** All web fonts are bundled locally (via @fontsource) so the app works offline. */
export const FONT_OPTIONS: FontOption[] = [
  { id: 'literata', label: 'Literata', stack: "'Literata Variable', Georgia, serif", kind: 'serif' },
  { id: 'georgia', label: 'Georgia', stack: "Georgia, 'Times New Roman', serif", kind: 'serif' },
  { id: 'merriweather', label: 'Merriweather', stack: "'Merriweather Variable', Georgia, serif", kind: 'serif' },
  { id: 'lora', label: 'Lora', stack: "'Lora Variable', Georgia, serif", kind: 'serif' },
  { id: 'source-serif', label: 'Source Serif', stack: "'Source Serif 4 Variable', Georgia, serif", kind: 'serif' },
  { id: 'system-serif', label: 'System Serif', stack: "ui-serif, 'New York', 'Iowan Old Style', Georgia, serif", kind: 'serif' },
  { id: 'inter', label: 'Inter', stack: "'Inter Variable', system-ui, sans-serif", kind: 'sans' },
  { id: 'open-sans', label: 'Open Sans', stack: "'Open Sans Variable', system-ui, sans-serif", kind: 'sans' },
  { id: 'roboto', label: 'Roboto', stack: "'Roboto Variable', system-ui, sans-serif", kind: 'sans' },
  { id: 'system-sans', label: 'System Sans', stack: "system-ui, -apple-system, 'Segoe UI', sans-serif", kind: 'sans' },
]

export function fontStack(id: string): string {
  return (FONT_OPTIONS.find((f) => f.id === id) ?? FONT_OPTIONS[0]).stack
}

export const LIMITS = {
  fontSize: { min: 13, max: 40, step: 1 },
  lineHeight: { min: 1.2, max: 2.4, step: 0.05 },
  paragraphSpacing: { min: 0, max: 2.5, step: 0.05 },
  // max is effectively "full width": the column is always capped by the window.
  readingWidth: { min: 300, max: 3000, step: 10 },
  autoScrollSpeed: { min: 4, max: 240, step: 1 },
  speechRate: { min: 0.5, max: 2, step: 0.05 },
} as const

export const DEFAULT_SETTINGS: ReadingSettings = {
  fontFamily: 'literata',
  fontSize: 20,
  lineHeight: 1.7,
  paragraphSpacing: 0.9,
  readingWidth: 680,
  textAlign: 'left',
  theme: 'light',
  ambientEnabled: false,
  ambientWarmth: 45,
  ambientDim: 15,
  autoScrollSpeed: 36,
  showPageMarkers: true,
  readAloud: false,
  speechVoice: '',
  speechRate: 1,
}

const KEY = 'folio.settings.v1'

function clamp(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback
  return Math.min(hi, Math.max(lo, n))
}

function sanitize(raw: Partial<ReadingSettings>): ReadingSettings {
  const d = DEFAULT_SETTINGS
  return {
    fontFamily: FONT_OPTIONS.some((f) => f.id === raw.fontFamily) ? raw.fontFamily! : d.fontFamily,
    fontSize: clamp(raw.fontSize, LIMITS.fontSize.min, LIMITS.fontSize.max, d.fontSize),
    lineHeight: clamp(raw.lineHeight, LIMITS.lineHeight.min, LIMITS.lineHeight.max, d.lineHeight),
    paragraphSpacing: clamp(raw.paragraphSpacing, LIMITS.paragraphSpacing.min, LIMITS.paragraphSpacing.max, d.paragraphSpacing),
    readingWidth: clamp(raw.readingWidth, LIMITS.readingWidth.min, LIMITS.readingWidth.max, d.readingWidth),
    textAlign: raw.textAlign === 'justify' ? 'justify' : 'left',
    theme: raw.theme && ['light', 'sepia', 'dark', 'comfort'].includes(raw.theme) ? raw.theme : d.theme,
    ambientEnabled: typeof raw.ambientEnabled === 'boolean' ? raw.ambientEnabled : d.ambientEnabled,
    ambientWarmth: clamp(raw.ambientWarmth, 0, 100, d.ambientWarmth),
    ambientDim: clamp(raw.ambientDim, 0, 100, d.ambientDim),
    autoScrollSpeed: clamp(raw.autoScrollSpeed, LIMITS.autoScrollSpeed.min, LIMITS.autoScrollSpeed.max, d.autoScrollSpeed),
    showPageMarkers: typeof raw.showPageMarkers === 'boolean' ? raw.showPageMarkers : d.showPageMarkers,
    readAloud: typeof raw.readAloud === 'boolean' ? raw.readAloud : d.readAloud,
    speechVoice: typeof raw.speechVoice === 'string' ? raw.speechVoice : d.speechVoice,
    speechRate: clamp(raw.speechRate, LIMITS.speechRate.min, LIMITS.speechRate.max, d.speechRate),
  }
}

function load(): ReadingSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return sanitize(JSON.parse(raw))
  } catch {
    // ignore corrupt/blocked storage
  }
  return { ...DEFAULT_SETTINGS }
}

let current = load()
const listeners = new Set<() => void>()
let saveTimer: ReturnType<typeof setTimeout> | undefined

export function getSettings(): ReadingSettings {
  return current
}

export function updateSettings(patch: Partial<ReadingSettings>): void {
  current = sanitize({ ...current, ...patch })
  listeners.forEach((l) => l())
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(current))
    } catch {
      // storage full or blocked – settings still work for this session
    }
  }, 150)
}

export function resetSettings(keep: Partial<ReadingSettings> = {}): void {
  updateSettings({ ...DEFAULT_SETTINGS, ...keep })
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useSettings(): ReadingSettings {
  return useSyncExternalStore(subscribe, getSettings, getSettings)
}

/** Human label for an auto-scroll speed in px/s. */
export function speedLabel(pxPerSec: number): string {
  if (pxPerSec < 14) return 'Very slow'
  if (pxPerSec < 28) return 'Slow'
  if (pxPerSec < 60) return 'Normal'
  if (pxPerSec < 110) return 'Fast'
  return 'Very fast'
}

/**
 * The speed slider uses a perceptual (logarithmic) scale: fine control at slow
 * reading speeds, larger steps at the fast end. Slider position is 0..1000.
 */
export function speedToSlider(speed: number): number {
  const { min, max } = LIMITS.autoScrollSpeed
  return Math.round((Math.log(speed / min) / Math.log(max / min)) * 1000)
}

export function sliderToSpeed(pos: number): number {
  const { min, max } = LIMITS.autoScrollSpeed
  const v = min * Math.pow(max / min, pos / 1000)
  return v < 20 ? Math.round(v * 2) / 2 : Math.round(v)
}

/** Next speed step for the +/- buttons (≈12% per step, feels even across the range). */
export function stepSpeed(speed: number, dir: 1 | -1): number {
  const next = dir > 0 ? Math.max(speed * 1.12, speed + 1) : Math.min(speed / 1.12, speed - 1)
  const { min, max } = LIMITS.autoScrollSpeed
  const rounded = next < 20 ? Math.round(next * 2) / 2 : Math.round(next)
  return Math.min(max, Math.max(min, rounded))
}
