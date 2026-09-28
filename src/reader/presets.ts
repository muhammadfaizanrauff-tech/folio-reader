import type { ThemeName } from '../types'

export const THEMES: { id: ThemeName; label: string; paper: string; ink: string; description: string }[] = [
  { id: 'light', label: 'Light', paper: '#f8f5ef', ink: '#1f1d1a', description: 'Warm off-white' },
  { id: 'sepia', label: 'Sepia', paper: '#f3e8d2', ink: '#45372a', description: 'Paper-like' },
  { id: 'dark', label: 'Dark', paper: '#111111', ink: '#e7e3dc', description: 'Near-black' },
  { id: 'comfort', label: 'Comfort', paper: '#231f1a', ink: '#cfbf9f', description: 'Warm, low contrast' },
]

export const SPEED_PRESETS = [
  { label: 'Very slow', value: 10 },
  { label: 'Slow', value: 20 },
  { label: 'Normal', value: 36 },
  { label: 'Fast', value: 70 },
  { label: 'Very fast', value: 140 },
]
