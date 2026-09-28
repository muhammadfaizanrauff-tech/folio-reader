import { useSettings } from '../storage/settings'

/**
 * "Ambient light": a warm tint + gentle dimming layered over the whole app
 * (including the PDF view). Purely a comfort feature – it changes colours on
 * screen, nothing more.
 */
export function AmbientOverlay() {
  const s = useSettings()
  if (!s.ambientEnabled) return null
  const warmth = s.ambientWarmth / 100
  const dim = s.ambientDim / 100
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[100] transition-colors duration-500"
        style={{ background: `rgb(255 ${Math.round(150 - warmth * 40)} ${Math.round(60 - warmth * 40)} / ${0.04 + warmth * 0.24})`, mixBlendMode: 'multiply' }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[101] transition-colors duration-500"
        style={{ background: `rgb(12 8 2 / ${dim * 0.55})` }}
      />
    </>
  )
}
